#!/bin/zsh

cd "/Users/ryansun/Documents/Expense Tracker" || exit 1

PORT=$(python3 - <<'PY'
import socket

preferred_port = 8123

for port in (preferred_port, 0):
    sock = socket.socket()
    try:
        sock.bind(("127.0.0.1", port))
    except OSError:
        sock.close()
        continue
    else:
        print(sock.getsockname()[1])
        sock.close()
        break
    finally:
        pass
PY
)

if [[ -z "${PORT}" ]]; then
  echo "Unable to find an open local port."
  exit 1
fi

URL="http://localhost:${PORT}"
echo "${URL}" > ".current-url"

python3 -m http.server "${PORT}" >/tmp/ledger-garden-server.log 2>&1 &
SERVER_PID=$!

sleep 1
open "${URL}"

echo "Ledger Garden is running at ${URL}"
echo "Server log: /tmp/ledger-garden-server.log"
echo "Current URL file: /Users/ryansun/Documents/Expense Tracker/.current-url"
echo "Press Control+C in this window to stop the server."

wait "${SERVER_PID}"
