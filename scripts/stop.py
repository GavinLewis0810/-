"""终止指定端口上的进程（用于开发服务器重启）"""
import subprocess, sys

ports = sys.argv[1:] if len(sys.argv) > 1 else ["18080", "5173"]

for port in ports:
    # netstat -ano | findstr :PORT
    out = subprocess.run(["netstat", "-ano"], capture_output=True, text=True).stdout
    for line in out.splitlines():
        if f":{port}" in line and "LISTENING" in line:
            pid = line.strip().split()[-1]
            subprocess.run(["taskkill", "/PID", pid, "/F"], capture_output=True)
            print(f"已终止端口 {port} (PID {pid})")

print("全部服务已停止。")
