const { useState, useEffect, useRef } = React;

function App() {
  const [peerId, setPeerId] = useState('');
  const [remotePeerId, setRemotePeerId] = useState('');
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState([]);
  const [connectionStatus, setConnectionStatus] = useState('Not Connected');
  const [isTyping, setIsTyping] = useState(false);
  const [notification, setNotification] = useState('');
  const [userName, setUserName] = useState('');
  const [remoteName, setRemoteName] = useState('');
  const [isNameSet, setIsNameSet] = useState(false);

  const peerInstance = useRef(null);
  const connRef = useRef(null);
  const cryptoKey = useRef(null);
  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  const showNotification = (msg) => {
    setNotification(msg);
    setTimeout(() => setNotification(''), 3000);
  };

  const generateKey = async () => {
    try {
      return await window.crypto.subtle.generateKey(
        {
          name: 'AES-GCM',
          length: 256,
        },
        true,
        ['encrypt', 'decrypt']
      );
    } catch (e) {
      showNotification('Failed to generate encryption key');
      return null;
    }
  };

  const arrayBufferToBase64 = (buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  };

  const base64ToArrayBuffer = (base64) => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  };

  const encryptMessage = async (text) => {
    if (!cryptoKey.current) {
      showNotification('Encryption key is not set');
      return null;
    }
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await window.crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: iv,
      },
      cryptoKey.current,
      data
    );
    return { 
      iv: arrayBufferToBase64(iv), 
      encrypted: arrayBufferToBase64(encrypted) 
    };
  };

  const decryptMessage = async ({ iv, encrypted }) => {
    try {
      const decrypted = await window.crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: base64ToArrayBuffer(iv),
        },
        cryptoKey.current,
        base64ToArrayBuffer(encrypted)
      );
      const decoder = new TextDecoder();
      return decoder.decode(decrypted);
    } catch (e) {
      return 'Decryption error';
    }
  };

  const exportKey = async (key) => {
    const exported = await window.crypto.subtle.exportKey('raw', key);
    return arrayBufferToBase64(exported);
  };

  const formatTimestamp = () => {
    return new Date().toLocaleString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const handleTyping = () => {
    if (connRef.current) {
      connRef.current.send({ type: 'typing', user: userName });
      
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      
      typingTimeoutRef.current = setTimeout(() => {
        if (connRef.current) {
          connRef.current.send({ type: 'stop-typing' });
        }
      }, 2000);
    }
  };

  const handleData = async (data) => {
    if (data.type === 'key') {
      try {
        cryptoKey.current = await window.crypto.subtle.importKey(
          'raw',
          base64ToArrayBuffer(data.key),
          { name: 'AES-GCM' },
          false,
          ['encrypt', 'decrypt']
        );
        setMessages(prev => [...prev, { sender: 'system', text: 'Received encryption key', timestamp: formatTimestamp() }]);
      } catch (e) {
        showNotification('Failed to import encryption key');
      }
    } else if (data.type === 'message') {
      const decryptedText = await decryptMessage(data);
      setMessages(prev => [...prev, { sender: 'remote', text: decryptedText, timestamp: formatTimestamp() }]);
      showNotification('New message received');
    } else if (data.type === 'typing') {
      setRemoteName(data.user || 'Peer');
      setIsTyping(true);
    } else if (data.type === 'stop-typing') {
      setIsTyping(false);
    } else if (data.type === 'user-info') {
      setRemoteName(data.name);
    }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const peer = new Peer({
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
        ]
      }
    });
    peerInstance.current = peer;

    peer.on('open', async (id) => {
      setPeerId(id);
      setConnectionStatus('Peer ID generated');
      cryptoKey.current = await generateKey();
    });

    peer.on('connection', (conn) => {
      connRef.current = conn;
      setConnectionStatus('Connected');
      showNotification('New connection established');
      
      conn.on('data', handleData);
      
      conn.on('close', () => {
        setConnectionStatus('Disconnected');
        setMessages(prev => [...prev, { sender: 'system', text: 'Connection has been disconnected', timestamp: formatTimestamp() }]);
        connRef.current = null;
        showNotification('Connection has been disconnected');
      });
    });

    peer.on('error', (err) => {
      setMessages(prev => [...prev, { sender: 'system', text: `Error: ${err.message}`, timestamp: formatTimestamp() }]);
      setConnectionStatus(`Error: ${err.type}`);
      showNotification(`Error: ${err.message}`);
    });

    return () => peer.destroy();
  }, []);

  const connectToPeer = async () => {
    if (!remotePeerId) {
      showNotification('Please enter a Peer ID');
      return;
    }
    setConnectionStatus('Connecting...');
    const conn = peerInstance.current.connect(remotePeerId);
    connRef.current = conn;
    
    conn.on('open', async () => {
      setConnectionStatus('Connected');
      const keyData = await exportKey(cryptoKey.current);
      conn.send({ type: 'key', key: keyData });
      
      if (userName) {
        conn.send({ type: 'user-info', name: userName });
      }
      
      setMessages(prev => [...prev, { sender: 'system', text: 'Sent encryption key', timestamp: formatTimestamp() }]);
      showNotification('Connection established');
      
      conn.on('data', handleData);
      
      conn.on('close', () => {
        setConnectionStatus('Disconnected');
        setMessages(prev => [...prev, { sender: 'system', text: 'Connection has been disconnected', timestamp: formatTimestamp() }]);
        connRef.current = null;
        showNotification('Connection has been disconnected');
      });
    });
    
    conn.on('error', (err) => {
      setMessages(prev => [...prev, { sender: 'system', text: `Connection error: ${err.message}`, timestamp: formatTimestamp() }]);
      setConnectionStatus(`Error: ${err.type}`);
      showNotification(`Connection error: ${err.message}`);
    });
  };

  const sendMessage = async () => {
    if (message && connRef.current && cryptoKey.current) {
      const encryptedMessage = await encryptMessage(message);
      if (!encryptedMessage) {
        return;
      }
      connRef.current.send({ type: 'message', ...encryptedMessage });
      setMessages(prev => [...prev, { sender: 'local', text: message, timestamp: formatTimestamp() }]);
      setMessage('');
      
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
        connRef.current.send({ type: 'stop-typing' });
      }
    } else {
      showNotification('You need to be connected and have an encryption key to send a message');
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      sendMessage();
    }
  };

  const handleMessageChange = (e) => {
    setMessage(e.target.value);
    handleTyping();
  };

  const copyPeerId = () => {
    navigator.clipboard.writeText(peerId);
    showNotification('Peer ID copied to clipboard');
  };

  const disconnect = () => {
    if (connRef.current) {
      connRef.current.close();
      connRef.current = null;
      setConnectionStatus('Disconnected');
      showNotification('Connection has been disconnected');
    }
  };

  const handleNameSubmit = () => {
    if (userName.trim()) {
      setIsNameSet(true);
    } else {
      showNotification('Please enter a name');
    }
  };

  if (!isNameSet) {
    return (
      <div className="min-h-screen gradient-bg flex items-center justify-center">
        <div className="bg-white p-6 max-w-md w-full shadow-xl">
          <h1 className="text-2xl font-bold mb-4 text-center gradient-bg bg-clip-text text-transparent">
            Please enter your name
          </h1>
          <input
            type="text"
            value={userName}
            onChange={(e) => setUserName(e.target.value)}
            placeholder="Your name"
            className="w-full p-3 border border-gray-300 mb-4"
            onKeyPress={(e) => e.key === 'Enter' && handleNameSubmit()}
          />
          <button
            onClick={handleNameSubmit}
            className="w-full bg-blue-500 text-white px-6 py-3 hover:bg-blue-600 transition-colors"
          >
            Start
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen gradient-bg">
      {notification && (
        <div className="fixed top-4 right-4 bg-green-500 text-white px-4 py-2 shadow-lg animate-pulse notification-fixed">
          {notification}
        </div>
      )}
      <div className="max-w-4xl mx-auto p-4 sm:p-6">
        {connectionStatus !== 'Connected' && (
          <div className="bg-white shadow-xl p-6 mb-6">
            <div className="flex justify-between items-center mb-4">
              <h1 className="text-3xl font-bold gradient-bg bg-clip-text text-transparent">
                P2P Encrypted Chat
              </h1>
            </div>
            
            <div className="grid grid-cols-1 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Your Peer ID</label>
                <div className="flex">
                  <input
                    type="text"
                    value={peerId}
                    readOnly
                    className="flex-1 p-2 border border-gray-300 font-mono text-sm"
                  />
                  <button
                    onClick={copyPeerId}
                    disabled={!peerId}
                    className="bg-indigo-500 text-white px-4 py-2 hover:bg-indigo-600 disabled:opacity-50 transition-colors"
                  >
                    Copy
                  </button>
                </div>
              </div>
            </div>
            
            <div className="mt-4 p-3 bg-green-100 text-green-800 connection-status">
              <div className="flex items-center">
                <div className="w-3 h-3 rounded-full mr-2 bg-green-500"></div>
                Connection Status: {connectionStatus}
              </div>
            </div>
          </div>
        )}

        {connectionStatus !== 'Connected' && (
          <div className="bg-white shadow-xl p-6 mb-6">
            <h2 className="text-xl font-semibold mb-4">Connect</h2>
            <div className="flex flex-col sm:flex-row gap-4">
              <input
                type="text"
                value={remotePeerId}
                onChange={(e) => setRemotePeerId(e.target.value)}
                placeholder="Enter Peer ID to connect"
                className="flex-1 p-3 border border-gray-300"
              />
              <button
                onClick={connectToPeer}
                disabled={!remotePeerId || connectionStatus === 'Connecting...'}
                className="bg-blue-500 text-white px-6 py-3 hover:bg-blue-600 disabled:opacity-50 transition-colors"
              >
                {connectionStatus === 'Connecting...' ? 'Connecting...' : 'Connect'}
              </button>
            </div>
          </div>
        )}

        {connectionStatus === 'Connected' && (
          <div className="bg-white shadow-xl p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold">
                Chat {remoteName && `with ${remoteName}`}
              </h2>
              <div className="flex gap-2">
                <button
                  onClick={disconnect}
                  className="text-red-500 hover:text-red-700 transition-colors"
                >
                  Disconnect
                </button>
              </div>
            </div>
            
            <div className="h-[60vh] overflow-y-auto border-2 border-dashed p-4 mb-4 bg-gray-50">
              {messages.map((msg, index) => (
                <div
                  key={index}
                  className={
                    msg.sender === 'local'
                      ? 'message-local'
                      : msg.sender === 'remote'
                      ? 'message-remote'
                      : 'message-system'
                  }
                >
                  <div
                    className={
                      msg.sender === 'system'
                        ? ''
                        : 'message-bubble'
                    }
                  >
                    <div className="text-xs opacity-70 mb-1">{msg.timestamp}</div>
                    <div className="break-words">{msg.text}</div>
                  </div>
                </div>
              ))}
              
              {isTyping && (
                <div className="message-remote mb-3">
                  <div className="message-bubble typing-indicator">
                    <div className="text-xs text-gray-500 mb-1">{remoteName}</div>
                    <div className="text-gray-600">Typing...</div>
                  </div>
                </div>
              )}
              
              <div ref={messagesEndRef} />
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                value={message}
                onChange={handleMessageChange}
                onKeyPress={handleKeyPress}
                placeholder="Type a message..."
                className="flex-1 p-3 border border-gray-300"
              />
              <button
                onClick={sendMessage}
                disabled={!message.trim()}
                className="bg-green-500 text-white px-6 py-3 hover:bg-green-600 disabled:opacity-50 transition-colors"
              >
                Send
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);