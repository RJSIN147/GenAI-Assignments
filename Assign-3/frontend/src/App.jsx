import React, { useState, useEffect, useRef } from 'react';
import {
  FileText,
  Plus,
  Send,
  Trash2,
  X,
  Upload,
  BookOpen,
  User,
  Bot,
  Loader2,
  ChevronRight
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import './App.css';

function App() {
  const [collections, setCollections] = useState([]);
  const [activeCollection, setActiveCollection] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState({ stage: '', message: '', progress: 0, total: 0 });
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [chatHistories, setChatHistories] = useState({});

  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    loadCollections();
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isChatLoading]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const loadCollections = async () => {
    try {
      const res = await fetch('/api/collections');
      const data = await res.json();
      setCollections(data.collections || []);
    } catch (err) {
      console.error('Failed to load collections:', err);
    }
  };

  const selectCollection = (col) => {
    // Save current history before switching
    if (activeCollection) {
      setChatHistories(prev => ({
        ...prev,
        [activeCollection.name]: messages
      }));
    }

    setActiveCollection(col);
    setMessages(chatHistories[col.name] || []);
  };

  const pollStatus = async (jobId) => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/status/${jobId}`);
        const data = await res.json();

        if (data.status === 'completed') {
          clearInterval(interval);
          setIsUploading(false);
          await loadCollections();
          setShowUploadModal(false);
          
          const newCol = {
            name: data.result.collectionName,
            fileName: data.result.fileName,
            totalChunks: data.result.totalChunks,
            totalPages: data.result.totalPages
          };
          selectCollection(newCol);
        } else if (data.status === 'failed') {
          clearInterval(interval);
          setIsUploading(false);
          alert(`Indexing failed: ${data.error}`);
        } else {
          setUploadStatus({
            stage: data.stage,
            message: data.message,
            progress: data.progress,
            total: data.total
          });
        }
      } catch (err) {
        console.error('Status polling error:', err);
      }
    }, 1500);
  };

  const handleUpload = async (file) => {
    if (!file) return;
    setIsUploading(true);
    setUploadStatus({ stage: 'uploading', message: 'Uploading file to server...', progress: 0, total: 0 });
    
    const formData = new FormData();
    formData.append('document', file);

    try {
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');

      // Start polling for status
      pollStatus(data.jobId);
    } catch (err) {
      alert(err.message);
      setIsUploading(false);
    }
  };

  const sendMessage = async () => {
    if (!input.trim() || !activeCollection || isChatLoading) return;

    const userMessage = { role: 'user', content: input };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput('');
    setIsChatLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: input,
          collectionName: activeCollection.name,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Chat failed');

      const aiMessage = {
        role: 'ai',
        content: data.answer,
        sources: data.sources
      };
      setMessages([...newMessages, aiMessage]);
    } catch (err) {
      setMessages([...newMessages, { role: 'ai', content: `Error: ${err.message}` }]);
    } finally {
      setIsChatLoading(false);
    }
  };

  const deleteDoc = async (e, colName) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this document?')) return;

    try {
      await fetch(`/api/collection/${colName}`, { method: 'DELETE' });
      if (activeCollection?.name === colName) {
        setActiveCollection(null);
        setMessages([]);
      }
      await loadCollections();
    } catch (err) {
      console.error('Delete failed:', err);
    }
  };

  return (
    <div className="app-container">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <BookOpen className="logo-icon" />
          <span className="sidebar-title">NotebookLM</span>
        </div>

        <button
          className="new-upload-btn"
          onClick={() => setShowUploadModal(true)}
        >
          <Plus size={16} />
          <span>New Document</span>
        </button>

        <nav className="nav-section">
          <div className="nav-label">Documents</div>
          <ul className="doc-list">
            {collections.map((col) => (
              <li
                key={col.name}
                className={`doc-item ${activeCollection?.name === col.name ? 'active' : ''}`}
                onClick={() => selectCollection(col)}
              >
                <FileText size={16} />
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {col.fileName}
                </span>
                <Trash2
                  size={14}
                  className="delete-icon"
                  onClick={(e) => deleteDoc(e, col.name)}
                />
              </li>
            ))}
          </ul>
        </nav>
      </aside>

      {/* Main Content */}
      <main className="main-content">
        {!activeCollection ? (
          <div className="welcome-screen">
            <BookOpen className="welcome-icon" />
            <h1 className="welcome-title">Your Research Assistant</h1>
            <p className="welcome-subtitle">
              Upload documents to start a conversation. Grounded in your data, powered by AI.
            </p>
            <button
              className="new-upload-btn"
              style={{ width: 'auto', padding: '12px 24px' }}
              onClick={() => setShowUploadModal(true)}
            >
              <Upload size={18} />
              <span>Upload First Document</span>
            </button>
          </div>
        ) : (
          <>
            <header className="chat-header">
              <div className="chat-header-info">
                <FileText size={18} className="logo-icon" />
                <div>
                  <div className="doc-name">{activeCollection.fileName}</div>
                  <div className="doc-meta">{activeCollection.totalPages} pages · {activeCollection.totalChunks} chunks</div>
                </div>
              </div>
            </header>

            <div className="messages-container">
              {messages.length === 0 && (
                <div className="message-wrapper">
                  <div className="message message-ai">
                    <div className="message-avatar"><Bot size={18} /></div>
                    <div className="message-content">
                      👋 I've analyzed <strong>{activeCollection.fileName}</strong>. What would you like to know?
                    </div>
                  </div>
                </div>
              )}
              {messages.map((msg, i) => (
                <div key={i} className="message-wrapper">
                  <div className={`message ${msg.role === 'user' ? 'message-user' : 'message-ai'}`}>
                    <div className="message-avatar">
                      {msg.role === 'user' ? <User size={18} /> : <Bot size={18} />}
                    </div>
                    <div className="message-content">
                      <div className="prose">
                        <ReactMarkdown>{msg.content}</ReactMarkdown>
                      </div>
                      {msg.sources && (
                        <div className="sources-container">
                          {msg.sources.map((s, j) => (
                            <span key={j} className="source-tag" title={s.preview}>
                              Page {s.pageNumber} · {(s.relevance * 100).toFixed(0)}%
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              {isChatLoading && (
                <div className="message-wrapper">
                  <div className="message message-ai">
                    <div className="message-avatar"><Bot size={18} /></div>
                    <div className="message-content">
                      <Loader2 size={18} className="animate-spin" />
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            <footer className="input-area">
              <div className="input-wrapper">
                <textarea
                  className="chat-input"
                  placeholder="Ask a question..."
                  rows={1}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      sendMessage();
                    }
                  }}
                />
                <button
                  className="send-btn"
                  disabled={!input.trim() || isChatLoading}
                  onClick={sendMessage}
                >
                  <Send size={18} />
                </button>
              </div>
            </footer>
          </>
        )}
      </main>

      {/* Upload Modal */}
      {showUploadModal && (
        <div className="modal-overlay" onClick={() => !isUploading && setShowUploadModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="close-modal" onClick={() => setShowUploadModal(false)}>
              <X size={20} />
            </button>
            <h2 style={{ marginBottom: '24px', fontSize: '18px' }}>Upload Document</h2>

            {isUploading ? (
              <div style={{ textAlign: 'center', padding: '40px 0' }}>
                <Loader2 size={32} className="animate-spin" style={{ margin: '0 auto 16px', color: 'var(--accent-color)' }} />
                <p style={{ color: 'var(--text-secondary)', fontWeight: '500' }}>
                  {uploadStatus.message || 'Processing...'}
                </p>
                {uploadStatus.total > 0 && (
                  <div style={{ marginTop: '12px' }}>
                    <div className="progress-bar-bg">
                      <div 
                        className="progress-bar-fill" 
                        style={{ width: `${(uploadStatus.progress / uploadStatus.total) * 100}%` }}
                      ></div>
                    </div>
                    <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '8px' }}>
                      {uploadStatus.progress} / {uploadStatus.total} chunks
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div
                className="drop-zone"
                onClick={() => fileInputRef.current.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (e.dataTransfer.files[0]) handleUpload(e.dataTransfer.files[0]);
                }}
              >
                <Upload className="drop-zone-icon" />
                <p style={{ fontSize: '14px', marginBottom: '8px' }}>Drag and drop files here</p>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>PDF or TXT up to 100MB</p>
                <input
                  type="file"
                  ref={fileInputRef}
                  style={{ display: 'none' }}
                  accept=".pdf,.txt"
                  onChange={(e) => handleUpload(e.target.files[0])}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
