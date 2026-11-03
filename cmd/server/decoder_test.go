package main

import (
	"bytes"
	"net/http/httptest"
	"os"
	"testing"
)

func TestInstalledDecoders(t *testing.T) {
	base := os.Getenv("VIEWER_FIXTURES")
	if base == "" {
		t.Skip("requires installed codecs and mount namespaces")
	}
	for _, tc := range []struct{ name, format, page string }{{"sample.djvu", "djvu", "2"}, {"image.tiff", "tiff", "1"}, {"image.heic", "heic", "1"}} {
		b, e := os.ReadFile(base + "/" + tc.name)
		if e != nil {
			t.Fatal(e)
		}
		r := httptest.NewRequest("POST", "/render?format="+tc.format+"&page="+tc.page, bytes.NewReader(b))
		w := httptest.NewRecorder()
		render(w, r)
		if w.Code != 200 || w.Header().Get("Content-Type") != "image/png" || tc.format == "djvu" && w.Header().Get("X-Page-Count") != "2" {
			t.Errorf("%s: %d %s", tc.format, w.Code, w.Body.String())
		}
	}
}

func TestOfficeConversion(t *testing.T) {
	base := os.Getenv("VIEWER_OFFICE_FIXTURES")
	if base == "" {
		t.Skip("requires LibreOffice and mount namespaces")
	}
	for _, tc := range []struct{ name, format string }{{"Slides.pptx", "pptx"}, {"Complex.docx", "docx"}} {
		data, err := os.ReadFile(base + "/" + tc.name)
		if err != nil {
			t.Fatal(err)
		}
		w := httptest.NewRecorder()
		render(w, httptest.NewRequest("POST", "/render?format="+tc.format+"&page=1", bytes.NewReader(data)))
		if w.Code != 200 || w.Header().Get("Content-Type") != "application/pdf" || !bytes.HasPrefix(w.Body.Bytes(), []byte("%PDF-")) {
			t.Fatalf("%s: %d %s", tc.name, w.Code, w.Body.String())
		}
	}
}
