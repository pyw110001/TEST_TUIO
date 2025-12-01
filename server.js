import { WebSocketServer } from 'ws';
import dgram from 'node:dgram';
import osc from 'osc-min';

/**
 * TUIO WebSocket to OSC/UDP Bridge Server
 * 将 WebSocket 接收的数据转换为 OSC 消息并通过 UDP 发送
 */
class TuioBridgeServer {
  constructor(options = {}) {
    this.wsPort = options.wsPort || 8080;
    this.udpHost = options.udpHost || '127.0.0.1';
    this.udpPort = options.udpPort || 3333;
    this.wss = null;
    this.udpClient = null;
    this.frameId = 0;
    this.activeCursors = new Map();
    this.activeObjects = new Map();
    this.activeBlobs = new Map();
  }

  /**
   * 启动服务器
   */
  start() {
    // 创建 UDP 客户端
    this.udpClient = dgram.createSocket('udp4');

    // 创建 WebSocket 服务器
    this.wss = new WebSocketServer({ port: this.wsPort });

    this.wss.on('connection', (ws) => {
      console.log(`[WebSocket] 新客户端连接: ${ws._socket.remoteAddress}`);
      
      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleWebSocketMessage(message);
        } catch (error) {
          console.error('[错误] 解析 WebSocket 消息失败:', error);
        }
      });

      ws.on('close', () => {
        console.log('[WebSocket] 客户端断开连接');
        // 清理所有活动对象
        this.sendAliveMessage();
      });

      ws.on('error', (error) => {
        console.error('[WebSocket] 错误:', error);
      });
    });

    console.log(`[TUIO Bridge] WebSocket 服务器启动在端口 ${this.wsPort}`);
    console.log(`[TUIO Bridge] UDP 目标: ${this.udpHost}:${this.udpPort}`);
    console.log(`[TUIO Bridge] 等待客户端连接...`);
  }

  /**
   * 处理 WebSocket 消息
   */
  handleWebSocketMessage(message) {
    switch (message.type) {
      case 'cursor':
        this.handleCursor(message);
        break;
      case 'object':
        this.handleObject(message);
        break;
      case 'blob':
        this.handleBlob(message);
        break;
      case 'frame':
        this.sendFrame();
        break;
      case 'reset':
        this.reset();
        break;
      default:
        console.warn('[警告] 未知的消息类型:', message.type);
    }
  }

  /**
   * 处理光标（触摸点）消息
   */
  handleCursor(message) {
    const { action, sessionId, x, y, xSpeed, ySpeed, motionAccel } = message;
    
    switch (action) {
      case 'add':
        this.activeCursors.set(sessionId, { x, y, xSpeed, ySpeed, motionAccel });
        this.sendCursorMessage('set', sessionId, x, y, xSpeed, ySpeed, motionAccel);
        break;
      case 'update':
        if (this.activeCursors.has(sessionId)) {
          this.activeCursors.set(sessionId, { x, y, xSpeed, ySpeed, motionAccel });
          this.sendCursorMessage('set', sessionId, x, y, xSpeed, ySpeed, motionAccel);
        }
        break;
      case 'remove':
        if (this.activeCursors.has(sessionId)) {
          this.sendCursorMessage('alive', sessionId);
          this.activeCursors.delete(sessionId);
        }
        break;
    }
  }

  /**
   * 处理对象（标记物）消息
   */
  handleObject(message) {
    const { action, sessionId, symbolId, x, y, angle, xSpeed, ySpeed, rotationSpeed, motionAccel, rotationAccel } = message;
    
    switch (action) {
      case 'add':
        this.activeObjects.set(sessionId, { symbolId, x, y, angle, xSpeed, ySpeed, rotationSpeed, motionAccel, rotationAccel });
        this.sendObjectMessage('set', sessionId, symbolId, x, y, angle, xSpeed, ySpeed, rotationSpeed, motionAccel, rotationAccel);
        break;
      case 'update':
        if (this.activeObjects.has(sessionId)) {
          this.activeObjects.set(sessionId, { symbolId, x, y, angle, xSpeed, ySpeed, rotationSpeed, motionAccel, rotationAccel });
          this.sendObjectMessage('set', sessionId, symbolId, x, y, angle, xSpeed, ySpeed, rotationSpeed, motionAccel, rotationAccel);
        }
        break;
      case 'remove':
        if (this.activeObjects.has(sessionId)) {
          this.sendObjectMessage('alive', sessionId);
          this.activeObjects.delete(sessionId);
        }
        break;
    }
  }

  /**
   * 处理 Blob 消息
   */
  handleBlob(message) {
    const { action, sessionId, x, y, angle, width, height, area, xSpeed, ySpeed, rotationSpeed, motionAccel, rotationAccel } = message;
    
    switch (action) {
      case 'add':
        this.activeBlobs.set(sessionId, { x, y, angle, width, height, area, xSpeed, ySpeed, rotationSpeed, motionAccel, rotationAccel });
        this.sendBlobMessage('set', sessionId, x, y, angle, width, height, area, xSpeed, ySpeed, rotationSpeed, motionAccel, rotationAccel);
        break;
      case 'update':
        if (this.activeBlobs.has(sessionId)) {
          this.activeBlobs.set(sessionId, { x, y, angle, width, height, area, xSpeed, ySpeed, rotationSpeed, motionAccel, rotationAccel });
          this.sendBlobMessage('set', sessionId, x, y, angle, width, height, area, xSpeed, ySpeed, rotationSpeed, motionAccel, rotationAccel);
        }
        break;
      case 'remove':
        if (this.activeBlobs.has(sessionId)) {
          this.sendBlobMessage('alive', sessionId);
          this.activeBlobs.delete(sessionId);
        }
        break;
    }
  }

  /**
   * 发送光标 OSC 消息
   */
  sendCursorMessage(type, sessionId, x = 0, y = 0, xSpeed = 0, ySpeed = 0, motionAccel = 0) {
    if (type === 'alive') {
      // 发送 alive 消息（只包含 sessionId）
      const oscMessage = {
        address: '/tuio/2Dcur',
        args: [
          { type: 's', value: 'alive' },
          { type: 'i', value: sessionId }
        ]
      };
      this.sendOSCMessage(oscMessage);
    } else {
      // 发送 set 消息
      const oscMessage = {
        address: '/tuio/2Dcur',
        args: [
          { type: 's', value: 'set' },
          { type: 'i', value: sessionId },
          { type: 'f', value: x },
          { type: 'f', value: y },
          { type: 'f', value: xSpeed },
          { type: 'f', value: ySpeed },
          { type: 'f', value: motionAccel }
        ]
      };
      this.sendOSCMessage(oscMessage);
    }
  }

  /**
   * 发送对象 OSC 消息
   */
  sendObjectMessage(type, sessionId, symbolId = 0, x = 0, y = 0, angle = 0, xSpeed = 0, ySpeed = 0, rotationSpeed = 0, motionAccel = 0, rotationAccel = 0) {
    if (type === 'alive') {
      const oscMessage = {
        address: '/tuio/2Dobj',
        args: [
          { type: 's', value: 'alive' },
          { type: 'i', value: sessionId }
        ]
      };
      this.sendOSCMessage(oscMessage);
    } else {
      const oscMessage = {
        address: '/tuio/2Dobj',
        args: [
          { type: 's', value: 'set' },
          { type: 'i', value: sessionId },
          { type: 'i', value: symbolId },
          { type: 'f', value: x },
          { type: 'f', value: y },
          { type: 'f', value: angle },
          { type: 'f', value: xSpeed },
          { type: 'f', value: ySpeed },
          { type: 'f', value: rotationSpeed },
          { type: 'f', value: motionAccel },
          { type: 'f', value: rotationAccel }
        ]
      };
      this.sendOSCMessage(oscMessage);
    }
  }

  /**
   * 发送 Blob OSC 消息
   */
  sendBlobMessage(type, sessionId, x = 0, y = 0, angle = 0, width = 0, height = 0, area = 0, xSpeed = 0, ySpeed = 0, rotationSpeed = 0, motionAccel = 0, rotationAccel = 0) {
    if (type === 'alive') {
      const oscMessage = {
        address: '/tuio/2Dblb',
        args: [
          { type: 's', value: 'alive' },
          { type: 'i', value: sessionId }
        ]
      };
      this.sendOSCMessage(oscMessage);
    } else {
      const oscMessage = {
        address: '/tuio/2Dblb',
        args: [
          { type: 's', value: 'set' },
          { type: 'i', value: sessionId },
          { type: 'f', value: x },
          { type: 'f', value: y },
          { type: 'f', value: angle },
          { type: 'f', value: width },
          { type: 'f', value: height },
          { type: 'f', value: area },
          { type: 'f', value: xSpeed },
          { type: 'f', value: ySpeed },
          { type: 'f', value: rotationSpeed },
          { type: 'f', value: motionAccel },
          { type: 'f', value: rotationAccel }
        ]
      };
      this.sendOSCMessage(oscMessage);
    }
  }

  /**
   * 发送 OSC 消息到 UDP
   */
  sendOSCMessage(oscMessage) {
    try {
      const buffer = osc.toBuffer(oscMessage);
      this.udpClient.send(buffer, 0, buffer.length, this.udpPort, this.udpHost, (err) => {
        if (err) {
          console.error('[UDP] 发送错误:', err);
        }
      });
    } catch (error) {
      console.error('[OSC] 消息构建错误:', error);
    }
  }

  /**
   * 发送帧消息
   */
  sendFrame() {
    // 发送 alive 消息（所有活动的 sessionId）
    const aliveCursors = Array.from(this.activeCursors.keys());
    const aliveObjects = Array.from(this.activeObjects.keys());
    const aliveBlobs = Array.from(this.activeBlobs.keys());

    if (aliveCursors.length > 0) {
      const aliveArgs = [
        { type: 's', value: 'alive' },
        ...aliveCursors.map(id => ({ type: 'i', value: id }))
      ];
      const aliveMessage = {
        address: '/tuio/2Dcur',
        args: aliveArgs
      };
      this.sendOSCMessage(aliveMessage);
    }

    if (aliveObjects.length > 0) {
      const aliveArgs = [
        { type: 's', value: 'alive' },
        ...aliveObjects.map(id => ({ type: 'i', value: id }))
      ];
      const aliveMessage = {
        address: '/tuio/2Dobj',
        args: aliveArgs
      };
      this.sendOSCMessage(aliveMessage);
    }

    if (aliveBlobs.length > 0) {
      const aliveArgs = [
        { type: 's', value: 'alive' },
        ...aliveBlobs.map(id => ({ type: 'i', value: id }))
      ];
      const aliveMessage = {
        address: '/tuio/2Dblb',
        args: aliveArgs
      };
      this.sendOSCMessage(aliveMessage);
    }

    // 发送 fseq 消息（帧序列号）
    const fseqMessage = {
      address: '/tuio/2Dcur',
      args: [
        { type: 's', value: 'fseq' },
        { type: 'i', value: this.frameId }
      ]
    };
    this.sendOSCMessage(fseqMessage);
    
    const fseqObjMessage = {
      address: '/tuio/2Dobj',
      args: [
        { type: 's', value: 'fseq' },
        { type: 'i', value: this.frameId }
      ]
    };
    this.sendOSCMessage(fseqObjMessage);
    
    const fseqBlbMessage = {
      address: '/tuio/2Dblb',
      args: [
        { type: 's', value: 'fseq' },
        { type: 'i', value: this.frameId }
      ]
    };
    this.sendOSCMessage(fseqBlbMessage);

    this.frameId++;
  }

  /**
   * 发送 alive 消息（用于清理）
   */
  sendAliveMessage() {
    // 发送空的 alive 消息
    const aliveMessage = {
      address: '/tuio/2Dcur',
      args: [{ type: 's', value: 'alive' }]
    };
    this.sendOSCMessage(aliveMessage);
    this.sendFrame();
  }

  /**
   * 重置所有状态
   */
  reset() {
    this.activeCursors.clear();
    this.activeObjects.clear();
    this.activeBlobs.clear();
    this.frameId = 0;
    this.sendAliveMessage();
    console.log('[TUIO Bridge] 状态已重置');
  }

  /**
   * 停止服务器
   */
  stop() {
    if (this.wss) {
      this.wss.close();
    }
    if (this.udpClient) {
      this.udpClient.close();
    }
    console.log('[TUIO Bridge] 服务器已停止');
  }
}

// 启动服务器
const server = new TuioBridgeServer({
  wsPort: process.env.WS_PORT || 8080,
  udpHost: process.env.UDP_HOST || '127.0.0.1',
  udpPort: process.env.UDP_PORT || 3333
});

server.start();

// 优雅关闭
process.on('SIGINT', () => {
  console.log('\n[TUIO Bridge] 正在关闭服务器...');
  server.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n[TUIO Bridge] 正在关闭服务器...');
  server.stop();
  process.exit(0);
});

