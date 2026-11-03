package main

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"github.com/PaNasMs/module-sdk/modulehost"
	"image"
	"image/color"
	"image/png"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const maxInput = 48 << 20

var slots = make(chan struct{}, 2)
var formats = map[string]string{"qoi": "QOI", "heic": "HEIC", "heif": "HEIC", "tif": "TIFF", "tiff": "TIFF", "psd": "PSD", "tga": "TGA", "pcx": "PCX", "dds": "DDS", "jp2": "JP2", "j2k": "J2K", "ppm": "PNM", "pgm": "PNM", "pbm": "PNM", "pnm": "PNM"}

func main() {
	modulehost.Serve("viewers", func(_ map[string]bool) http.Handler { return http.HandlerFunc(render) })
}

type limited struct {
	buf   bytes.Buffer
	limit int
}

func (b *limited) Write(p []byte) (int, error) {
	if len(p) > b.limit-b.buf.Len() {
		return 0, errors.New("output too large")
	}
	return b.buf.Write(p)
}
func run(ctx context.Context, input, bin string, args ...string) ([]byte, error) {
	// Only the decoder, its runtime and one read-only document enter the namespace.
	// In particular, indirect DjVu references cannot reach user files or the network.
	a := []string{"--as=1073741824", "--cpu=12", "--fsize=50331648", "--", "/usr/bin/bwrap", "--die-with-parent", "--new-session", "--unshare-all", "--cap-drop", "ALL", "--uid", "65534", "--gid", "65534", "--clearenv", "--setenv", "PATH", "/usr/bin", "--setenv", "HOME", "/tmp", "--setenv", "MAGICK_THREAD_LIMIT", "1", "--ro-bind", "/usr/lib", "/usr/lib", "--symlink", "usr/lib", "/lib", "--ro-bind-try", "/usr/lib64", "/usr/lib64", "--symlink", "usr/lib64", "/lib64", "--ro-bind", bin, bin, "--ro-bind-try", "/etc/ImageMagick-6", "/etc/ImageMagick-6", "--ro-bind-try", "/etc/ImageMagick-7", "/etc/ImageMagick-7", "--dev", "/dev", "--size", "67108864", "--tmpfs", "/tmp", "--ro-bind", input, "/document", "--chdir", "/tmp", "--", bin}
	cmd := exec.CommandContext(ctx, "/usr/bin/prlimit", append(a, args...)...)
	var output limited
	output.limit = 24 << 20
	cmd.Stdout = &output
	err := cmd.Run()
	return output.buf.Bytes(), err
}
func render(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/render" || r.Method != "POST" {
		http.NotFound(w, r)
		return
	}
	kind := r.URL.Query().Get("format")
	office := kind == "docx" || kind == "pptx"
	coder := formats[kind]
	page, e := strconv.Atoi(r.URL.Query().Get("page"))
	if e != nil || page < 1 || page > 100000 || (kind != "djvu" && !office && coder == "") {
		http.Error(w, "Invalid format or page", 400)
		return
	}
	select {
	case slots <- struct{}{}:
		defer func() { <-slots }()
	default:
		http.Error(w, "Decoder busy", 429)
		return
	}
	timeout := 22 * time.Second
	if office {
		timeout = 55 * time.Second
	}
	ctx, cancel := context.WithTimeout(r.Context(), timeout)
	defer cancel()
	dir, e := os.MkdirTemp("", "viewer-input-")
	if e != nil {
		http.Error(w, "Temporary storage unavailable", 503)
		return
	}
	defer os.RemoveAll(dir)
	f, e := os.OpenFile(filepath.Join(dir, "input"), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0444)
	if e != nil {
		http.Error(w, "Temporary storage unavailable", 503)
		return
	}
	_ = http.NewResponseController(w).SetReadDeadline(time.Now().Add(45 * time.Second))
	_, e = io.Copy(f, http.MaxBytesReader(w, r.Body, maxInput))
	ce := f.Chmod(0444)
	if closeErr := f.Close(); ce == nil {
		ce = closeErr
	}
	if e != nil || ce != nil {
		http.Error(w, "Could not receive document", 413)
		return
	}
	// The bind mount is read-only. The private parent directory stops other host users reading it.
	var data []byte
	if office {
		data, e = officePDF(ctx, f.Name(), kind)
		if e != nil {
			http.Error(w, "Cannot render office document", 422)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Type", "application/pdf")
		w.Write(data)
		return
	}
	if kind == "djvu" {
		n, err := run(ctx, f.Name(), "/usr/bin/djvused", "/document", "-e", "n")
		count, pe := strconv.Atoi(strings.TrimSpace(string(n)))
		if err == nil && pe == nil && page <= count {
			data, e = run(ctx, f.Name(), "/usr/bin/ddjvu", "-format=ppm", "-size=2200x2200", "-page="+strconv.Itoa(page), "/document", "-")
			if e == nil {
				data, e = ppmPNG(data)
			}
			w.Header().Set("X-Page-Count", strconv.Itoa(count))
		} else {
			e = errors.New("invalid DjVu")
		}
	} else {
		size := "3200x3200>"
		if r.URL.Query().Get("thumbnail") == "1" {
			size = "176x176>"
		}
		data, e = run(ctx, f.Name(), "/usr/bin/convert", "-limit", "memory", "128MiB", "-limit", "map", "128MiB", "-limit", "disk", "32MiB", "-limit", "area", "32MP", coder+":/document[0]", "-auto-orient", "-thumbnail", size, "-strip", "png:-")
	}
	if e != nil || !bytes.HasPrefix(data, []byte("\x89PNG\r\n\x1a\n")) {
		http.Error(w, "Cannot decode document", 422)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "image/png")
	w.Write(data)
}
func ppmPNG(raw []byte) ([]byte, error) {
	r := bufio.NewReader(bytes.NewReader(raw))
	var magic string
	var width, height, max int
	if _, e := fmt.Fscan(r, &magic, &width, &height, &max); e != nil || magic != "P6" || width < 1 || height < 1 || width > 2200 || height > 2200 || max != 255 {
		return nil, errors.New("invalid page")
	}
	sep, e := r.ReadByte()
	if e != nil || (sep != '\n' && sep != ' ') {
		return nil, errors.New("invalid raster")
	}
	img := image.NewRGBA(image.Rect(0, 0, width, height))
	row := make([]byte, width*3)
	for y := 0; y < height; y++ {
		if _, e := io.ReadFull(r, row); e != nil {
			return nil, e
		}
		for x := 0; x < width; x++ {
			img.SetRGBA(x, y, color.RGBA{row[3*x], row[3*x+1], row[3*x+2], 255})
		}
	}
	var b bytes.Buffer
	e = png.Encode(&b, img)
	return b.Bytes(), e
}
