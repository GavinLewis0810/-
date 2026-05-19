# 停止 Invoice Manager 开发服务器（按端口终止进程）
param([int[]]$Ports = @(18080, 5173))

foreach ($port in $Ports) {
    $conns = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
    foreach ($c in $conns) {
        Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
        Write-Host "已终止端口 $port (PID $($c.OwningProcess))"
    }
}
Write-Host "全部服务已停止。"
