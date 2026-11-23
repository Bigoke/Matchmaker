package main

import (
	_ "embed"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sync/atomic"
	"time"
)

//go:embed Matchmaker.html
var page []byte

var lastBeat int64

func browsers() []string {
	pf, pf86, la := os.Getenv("ProgramFiles"), os.Getenv("ProgramFiles(x86)"), os.Getenv("LocalAppData")
	var c []string
	for _, b := range []string{pf, pf86, la} {
		if b == "" {
			continue
		}
		c = append(c, filepath.Join(b, `Microsoft\Edge\Application\msedge.exe`), filepath.Join(b, `Google\Chrome\Application\chrome.exe`))
	}
	return c
}

func main() {
	// A fixed port keeps the browser's saved data (localStorage) stable between runs.
	ln, err := net.Listen("tcp", "127.0.0.1:47831")
	if err != nil { // already running: just open another window and exit
		openWindow("http://127.0.0.1:47831/")
		return
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		w.Write(page)
	})
	mux.HandleFunc("/beat", func(w http.ResponseWriter, r *http.Request) {
		atomic.StoreInt64(&lastBeat, time.Now().Unix())
		w.WriteHeader(204)
	})
	atomic.StoreInt64(&lastBeat, time.Now().Unix())
	go http.Serve(ln, mux)
	openWindow("http://127.0.0.1:47831/")
	// Exit once the window has stopped sending heartbeats.
	for {
		time.Sleep(5 * time.Second)
		if time.Now().Unix()-atomic.LoadInt64(&lastBeat) > 45 {
			return
		}
	}
}

func openWindow(url string) {
	profile := filepath.Join(os.Getenv("LocalAppData"), "Matchmaker", "profile")
	os.MkdirAll(profile, 0o755)
	for _, b := range browsers() {
		if _, err := os.Stat(b); err == nil {
			cmd := exec.Command(b, "--app="+url, "--user-data-dir="+profile, "--no-first-run", "--window-size=1400,900")
			if cmd.Start() == nil {
				return
			}
		}
	}
	fmt.Println("Matchmaker needs Microsoft Edge or Google Chrome.")
	exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
}
