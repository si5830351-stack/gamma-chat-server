const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');

// Секретный защитный токен рукопожатия лаунчера
const SECRET_SECURITY_KEY = 'GammaSecureLauncherNetworkKey_2026_X9';
const PORT = process.env.PORT || 10000;

// HTTP сервер (отбивает любые браузерные запросы и сканеры)
const server = http.createServer((req, res) => {
  res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Access Denied. Gamma Network Protocol Endpoint.');
});

// WebSocket сервер
const wss = new WebSocketServer({ server });

// Хранилище активных клиентов: userId/username -> WebSocket
const clients = new Map();

wss.on('connection', (ws, req) => {
  let authenticatedUser = null;

  // Автоматический тайм-аут: если клиент не прислал секретный ключ за 5 сек — кикаем
  const authTimeout = setTimeout(() => {
    if (!authenticatedUser) {
      ws.close(4001, 'Unauthorized');
    }
  }, 5000);

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());

      // 1. Рукопожатие и авторизация с проверкой секретного токена
      if (msg.type === 'auth') {
        if (msg.secretKey !== SECRET_SECURITY_KEY || !msg.username) {
          ws.close(4003, 'Forbidden');
          return;
        }

        clearTimeout(authTimeout);
        authenticatedUser = msg.username;
        clients.set(authenticatedUser, ws);

        ws.send(JSON.stringify({
          type: 'auth_success',
          onlineUsers: Array.from(clients.keys()),
          timestamp: Date.now()
        }));

        // Оповещаем остальных, что игрок в сети
        broadcast({
          type: 'user_online',
          username: authenticatedUser,
          status: msg.status || 'В лаунчере'
        }, authenticatedUser);

        return;
      }

      // Все остальные действия требуют успешной авторизации
      if (!authenticatedUser) {
        ws.close(4001, 'Unauthorized');
        return;
      }

      // 2. Личные сообщения между игроками
      if (msg.type === 'chat_message') {
        const targetWs = clients.get(msg.to);
        const payload = {
          type: 'chat_message',
          from: authenticatedUser,
          to: msg.to,
          text: msg.text,
          timestamp: Date.now()
        };

        if (targetWs && targetWs.readyState === WebSocket.OPEN) {
          targetWs.send(JSON.stringify(payload));
          ws.send(JSON.stringify({ type: 'message_delivered', to: msg.to, id: msg.id }));
        } else {
          ws.send(JSON.stringify({ type: 'user_offline', to: msg.to }));
        }
      }

      // 3. Статус активности (например "В игре на сервере Hypixel")
      if (msg.type === 'status_update') {
        broadcast({
          type: 'status_update',
          username: authenticatedUser,
          status: msg.status
        });
      }

    } catch (e) {
      // Игнорируем битые пакеты
    }
  });

  ws.on('close', () => {
    clearTimeout(authTimeout);
    if (authenticatedUser) {
      clients.delete(authenticatedUser);
      broadcast({
        type: 'user_offline',
        username: authenticatedUser
      });
    }
  });
});

function broadcast(data, exceptUser = null) {
  const payload = JSON.stringify(data);
  for (const [user, ws] of clients.entries()) {
    if (user !== exceptUser && ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  }
}

server.listen(PORT, () => {
  console.log(`Gamma Chat Server running on port ${PORT}`);
});
