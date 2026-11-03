package main

import (
	"archive/zip"
	"bytes"
	"context"
	"errors"
	"os/exec"
)

// Convert a single presentation or Word document in a fresh, offline namespace.
// The PDF leaves through stdout; the profile and all converter output stay on tmpfs.
func officePDF(ctx context.Context, input, format string) ([]byte, error) {
	z, err := zip.OpenReader(input)
	if err != nil {
		return nil, err
	}
	defer z.Close()
	expected := map[string]string{"docx": "word/document.xml", "pptx": "ppt/presentation.xml"}[format]
	var found bool
	var size uint64
	if expected == "" || len(z.File) > 8000 {
		return nil, errors.New("unsupported package")
	}
	for _, f := range z.File {
		if f.UncompressedSize64 > 128<<20-size {
			return nil, errors.New("oversized package")
		}
		size += f.UncompressedSize64
		found = found || f.Name == expected
	}
	if !found {
		return nil, errors.New("missing office document")
	}
	args := []string{"--as=2147483648", "--cpu=40", "--fsize=50331648", "--", "/usr/bin/bwrap", "--die-with-parent", "--new-session", "--unshare-all", "--cap-drop", "ALL", "--uid", "65534", "--gid", "65534", "--clearenv", "--setenv", "HOME", "/tmp", "--setenv", "TMPDIR", "/tmp", "--setenv", "LANG", "C.UTF-8", "--setenv", "SAL_USE_VCLPLUGIN", "svp", "--setenv", "PATH", "/usr/bin", "--ro-bind", "/usr/bin", "/usr/bin", "--symlink", "usr/bin", "/bin", "--ro-bind", "/usr/lib", "/usr/lib", "--symlink", "usr/lib", "/lib", "--ro-bind-try", "/usr/lib64", "/usr/lib64", "--symlink", "usr/lib64", "/lib64"}
	for _, p := range []string{"/usr/share/libreoffice", "/usr/share/fonts", "/usr/share/fontconfig", "/etc/fonts", "/etc/libreoffice", "/var/cache/fontconfig", "/usr/share/misc"} {
		args = append(args, "--ro-bind-try", p, p)
	}
	args = append(args, "--proc", "/proc", "--dev", "/dev", "--size", "201326592", "--tmpfs", "/tmp", "--ro-bind", input, "/document."+format, "--chdir", "/tmp", "--", "/bin/sh", "-ec", `/usr/lib/libreoffice/program/oosplash -env:UserInstallation=file:///tmp/profile --headless --nologo --norestore --convert-to pdf --outdir /tmp "$1" >/dev/null && exec cat /tmp/document.pdf`, "office", "/document."+format)
	var out limited
	out.limit = 48 << 20
	cmd := exec.CommandContext(ctx, "/usr/bin/prlimit", args...)
	cmd.Stdout = &out
	if err = cmd.Run(); err != nil {
		return nil, err
	}
	if !bytes.HasPrefix(out.buf.Bytes(), []byte("%PDF-")) {
		return nil, errors.New("conversion failed")
	}
	return out.buf.Bytes(), nil
}
