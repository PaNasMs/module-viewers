package main

import (
	"bytes"
	"image/png"
	"net/http/httptest"
	"testing"
)

func TestPageRaster(t *testing.T) {
	b, e := ppmPNG([]byte("P6\n2 1\n255\n\x01\x02\x03\xff\xfe\xfd"))
	if e != nil {
		t.Fatal(e)
	}
	i, e := png.Decode(bytes.NewReader(b))
	if e != nil {
		t.Fatal(e)
	}
	r, g, b2, _ := i.At(1, 0).RGBA()
	if r>>8 != 255 || g>>8 != 254 || b2>>8 != 253 {
		t.Fatal(r, g, b2)
	}
	for _, bad := range []string{"P6\n40000 40000\n255\n", "P6\n2 1\n255\nxyz"} {
		if _, e := ppmPNG([]byte(bad)); e == nil {
			t.Fatal("accepted bad raster")
		}
	}
}
func TestRejectArbitraryDecoder(t *testing.T) {
	req := httptest.NewRequest("POST", "/render?format=MVG&page=1", bytes.NewBufferString("push graphic-context"))
	w := httptest.NewRecorder()
	render(w, req)
	if w.Code != 400 {
		t.Fatal(w.Code)
	}
}
