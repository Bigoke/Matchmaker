//go:build windows

// Matchmaker Setup: installs for the current user (no administrator rights needed),
// adds Start-menu / desktop shortcuts and an "Apps & features" uninstall entry.
package main

import (
	"bytes"
	"compress/gzip"
	_ "embed"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"unsafe"
)

//go:embed payload.exe.gz
var payload []byte

var version = "dev"

const appName = "Matchmaker"
const regKey = `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\Matchmaker`

var user32 = syscall.NewLazyDLL("user32.dll")
var msgBox = user32.NewProc("MessageBoxW")

func box(text string, flags uintptr) int {
	t, _ := syscall.UTF16PtrFromString(text)
	c, _ := syscall.UTF16PtrFromString(appName + " " + version)
	r, _, _ := msgBox.Call(0, uintptr(unsafe.Pointer(t)), uintptr(unsafe.Pointer(c)), flags|0x10000) // MB_SETFOREGROUND
	return int(r)
}

func ask(text string) bool { return box(text, 0x24) == 6 } // YESNO | ICONQUESTION
func info(text string)     { box(text, 0x40) }
func fail(text string)     { box(text, 0x10) }

func run(name string, args ...string) error {
	c := exec.Command(name, args...)
	c.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
	return c.Run()
}

func ps(script string) error {
	return run("powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script)
}

func q(s string) string { return "'" + strings.ReplaceAll(s, "'", "''") + "'" }

func installDir() string { return filepath.Join(os.Getenv("LocalAppData"), "Programs", appName) }
func dataDir() string    { return filepath.Join(os.Getenv("LocalAppData"), appName) }
func startMenu() string {
	return filepath.Join(os.Getenv("AppData"), `Microsoft\Windows\Start Menu\Programs`, appName+".lnk")
}
func desktop() string {
	d := os.Getenv("USERPROFILE")
	if d == "" {
		return ""
	}
	return filepath.Join(d, "Desktop", appName+".lnk")
}

func shortcut(lnk, target, dir string) error {
	os.MkdirAll(filepath.Dir(lnk), 0o755)
	return ps(fmt.Sprintf("$s=(New-Object -ComObject WScript.Shell).CreateShortcut(%s);$s.TargetPath=%s;$s.WorkingDirectory=%s;$s.IconLocation=%s;$s.Description='Match intercompany loans, ledgers and statements';$s.Save()",
		q(lnk), q(target), q(dir), q(target+",0")))
}

func killApp() {
	run("taskkill", "/F", "/IM", "Matchmaker.exe")
	run("cmd", "/c", "ping -n 2 127.0.0.1 >nul")
}

func install(silent bool) {
	dir := installDir()
	_, was := os.Stat(filepath.Join(dir, "Matchmaker.exe"))
	verb := "install"
	if was == nil {
		verb = "update"
	}
	desk := false
	if !silent {
		if !ask(fmt.Sprintf("This will %s Matchmaker %s on your computer.\n\nLocation:\n%s\n\nIt is installed for your user only – no administrator rights are needed, and your saved work is kept.\n\nContinue?", verb, version, dir)) {
			return
		}
		desk = ask("Add a Matchmaker shortcut to your desktop?")
	} else {
		desk = true
	}
	killApp()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		fail("Could not create the install folder:\n" + err.Error())
		return
	}
	zr, err := gzip.NewReader(bytes.NewReader(payload))
	if err == nil {
		exe := filepath.Join(dir, "Matchmaker.exe")
		var f *os.File
		if f, err = os.Create(exe); err == nil {
			_, err = io.Copy(f, zr)
			f.Close()
		}
	}
	if err != nil {
		fail("Could not copy the program files:\n" + err.Error())
		return
	}
	self, _ := os.Executable()
	if b, e := os.ReadFile(self); e == nil {
		os.WriteFile(filepath.Join(dir, "uninstall.exe"), b, 0o755)
	}
	exe := filepath.Join(dir, "Matchmaker.exe")
	shortcut(startMenu(), exe, dir)
	if desk && desktop() != "" {
		shortcut(desktop(), exe, dir)
	}
	un := fmt.Sprintf(`"%s" /uninstall`, filepath.Join(dir, "uninstall.exe"))
	for _, kv := range [][]string{{"DisplayName", appName}, {"DisplayVersion", version}, {"Publisher", appName}, {"InstallLocation", dir}, {"DisplayIcon", exe}, {"UninstallString", un}} {
		run("reg", "add", regKey, "/v", kv[0], "/t", "REG_SZ", "/d", kv[1], "/f")
	}
	for _, kv := range []string{"NoModify", "NoRepair"} {
		run("reg", "add", regKey, "/v", kv, "/t", "REG_DWORD", "/d", "1", "/f")
	}
	if silent {
		return
	}
	if ask("Matchmaker is installed.\n\nStart it now?") {
		c := exec.Command(exe)
		c.Dir = dir
		c.Start()
	}
}

func uninstall(silent bool) {
	if !silent && !ask("Remove Matchmaker from this computer?") {
		return
	}
	wipe := false
	if !silent {
		wipe = ask("Also delete your saved Matchmaker data (remembered decisions, settings and autosaved work)?\n\nChoose No to keep it in case you reinstall.")
	}
	killApp()
	os.Remove(startMenu())
	if d := desktop(); d != "" {
		os.Remove(d)
	}
	run("reg", "delete", regKey, "/f")
	if wipe {
		os.RemoveAll(dataDir())
	}
	dir := installDir()
	os.Remove(filepath.Join(dir, "Matchmaker.exe"))
	// the uninstaller is running from this folder: remove it a moment after we exit
	c := exec.Command("cmd", "/c", fmt.Sprintf(`ping -n 3 127.0.0.1 >nul & rmdir /s /q "%s"`, dir))
	c.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
	c.Start()
	if !silent {
		info("Matchmaker has been removed.")
	}
}

func main() {
	silent := false
	un := strings.EqualFold(filepath.Base(os.Args[0]), "uninstall.exe")
	for _, a := range os.Args[1:] {
		switch strings.ToLower(a) {
		case "/s", "/q", "/silent":
			silent = true
		case "/uninstall":
			un = true
		}
	}
	if un {
		uninstall(silent)
	} else {
		install(silent)
	}
}
