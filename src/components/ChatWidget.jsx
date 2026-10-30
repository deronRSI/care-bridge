import { useState, useRef, useEffect, useCallback } from 'react';
import Chart from 'chart.js/auto';
import { sendToAgentChat } from '../services/agentChat';
import { simpleMarkdown, extractChartData, formatTime } from '../utils';

function ChartBlock({ chartData }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current || !chartData) return;
    if (chartRef.current) chartRef.current.destroy();
    chartRef.current = new Chart(canvasRef.current, {
      type: 'line',
      data: {
        labels: chartData.labels,
        datasets: [{
          label: chartData.title || 'Data',
          data: chartData.values,
          backgroundColor: 'rgba(13,148,136,0.1)',
          borderColor: '#0d9488',
          borderWidth: 2,
          pointBackgroundColor: '#0f766e',
          pointRadius: 4,
          tension: 0.3,
          fill: true
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false },
          title: { display: !!chartData.title, text: chartData.title || '', font: { size: 13 } },
          tooltip: {
            callbacks: {
              title: (items) => { const raw = chartData.labels[items[0].dataIndex]; const d = new Date(raw); if (isNaN(d)) return raw; const mm = String(d.getMonth()+1).padStart(2,'0'); const dd = String(d.getDate()).padStart(2,'0'); const yy = String(d.getFullYear()).slice(-2); return `${mm}-${dd}-${yy}` },
              label: (ctx) => ctx.raw
            }
          }
        },
        scales: {
          y: { beginAtZero: false, grid: { color: '#f0f0f0' } },
          x: { grid: { display: false }, ticks: { callback: (_, i) => { const raw = chartData.labels[i]; const d = new Date(raw); if (isNaN(d)) return raw; const mm = String(d.getMonth()+1).padStart(2,'0'); const dd = String(d.getDate()).padStart(2,'0'); const yy = String(d.getFullYear()).slice(-2); return `${mm}-${dd}-${yy}` }, font: { size: 10 }, maxRotation: 45, minRotation: 45 } }
        }
      }
    });
    return () => { if (chartRef.current) chartRef.current.destroy(); };
  }, [chartData]);

  return (
    <div style={{ marginTop: '14px', maxWidth: '440px', background: '#f8fafc', borderRadius: '10px', padding: '12px' }}>
      <canvas ref={canvasRef} />
    </div>
  );
}

const PREDEFINED_ITEMS = [
  { label: 'Search Patient' },
  { label: 'View Active Conditions', action: 'conditions' },
  { label: 'View Latest Observations', action: 'lab' },
  { label: 'View Active Medications', action: 'medications' },
  { label: 'View Last 12 months encounters', action: 'encounters' },
  { label: 'View Care Gaps', action: 'caregaps', query: 'View Care Gaps in details' },
  { label: 'Observation Trends', query: 'Plot trends but I want you to ask me for which observation? Then after my response you plot the line graph' },
];

export default function ChatWidget({ displayName }) {
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [isTyping, setIsTyping] = useState(false);
  const [retryMessage, setRetryMessage] = useState('');
  const [isBotResponding, setIsBotResponding] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [showWelcome, setShowWelcome] = useState(true);

  const conversationHistoryRef = useRef([]);
  const currentPatientRef = useRef(null);
  const pendingChipActionRef = useRef(null);
  const messagesAreaRef = useRef(null);
  const inputRef = useRef(null);
  const panelRef = useRef(null);
  const isResizingRef = useRef(false);
  const resizeStartRef = useRef({ x: 0, y: 0, w: 0, h: 0 });

  const userInitial = displayName.charAt(0).toUpperCase();

  const userScrolledUpRef = useRef(false);

  const handleResizeStart = useCallback((e) => {
    e.preventDefault();
    const panel = panelRef.current;
    if (!panel) return;
    isResizingRef.current = true;
    resizeStartRef.current = {
      x: e.clientX || e.touches?.[0]?.clientX || 0,
      y: e.clientY || e.touches?.[0]?.clientY || 0,
      w: panel.offsetWidth,
      h: panel.offsetHeight,
    };
    const onMove = (ev) => {
      if (!isResizingRef.current) return;
      const cx = ev.clientX || ev.touches?.[0]?.clientX || 0;
      const cy = ev.clientY || ev.touches?.[0]?.clientY || 0;
      const newW = Math.max(320, resizeStartRef.current.w - (cx - resizeStartRef.current.x));
      const newH = Math.max(300, resizeStartRef.current.h - (cy - resizeStartRef.current.y));
      panel.style.width = Math.min(newW, window.innerWidth - 40) + 'px';
      panel.style.height = Math.min(newH, window.innerHeight - 100) + 'px';
    };
    const onEnd = () => {
      isResizingRef.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onEnd);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onEnd);
    document.addEventListener('touchmove', onMove);
    document.addEventListener('touchend', onEnd);
  }, []);

  const scrollToBottom = useCallback(() => {
    if (messagesAreaRef.current && !userScrolledUpRef.current) {
      messagesAreaRef.current.scrollTop = messagesAreaRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, isTyping, scrollToBottom]);

  const handleMessagesScroll = useCallback(() => {
    const el = messagesAreaRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    userScrolledUpRef.current = distanceFromBottom > 80;
  }, []);

  useEffect(() => {
    const handleClickOutside = () => setShowDropdown(false);
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  const addMessage = useCallback((role, content, extra = {}) => {
    const msg = { id: Date.now() + Math.random(), role, content, timestamp: formatTime(), isStreaming: false, ...extra };
    setMessages(prev => [...prev, msg]);
    setShowWelcome(false);
    return msg.id;
  }, []);

  const agentLoop = useCallback(async (userMessage) => {
    const history = conversationHistoryRef.current;
    history.push({ role: 'user', content: userMessage });

    const sliced = history.slice(-20);
    const firstUserIdx = sliced.findIndex(m => m.role === 'user');
    const trimmedHistory = firstUserIdx > 0 ? sliced.slice(firstUserIdx) : sliced;

    setIsTyping(true);
    let streamingMsgId = null;
    let chunkAccum = '';

    try {
      // Prompt-building, tool selection, and FHIR tool execution all happen
      // server-side now (agent-service's `carebridge` agent) — one call
      // covers the whole turn, including however many tool round-trips the
      // model needed internally.
      const result = await sendToAgentChat(
        trimmedHistory,
        (chunk) => {
          if (!streamingMsgId) {
            setIsTyping(false);
            streamingMsgId = Date.now() + Math.random();
            setMessages(prev => [...prev, { id: streamingMsgId, role: 'bot', content: '', timestamp: formatTime(), isStreaming: true }]);
            setShowWelcome(false);
          }
          chunkAccum += chunk;
          const contentSoFar = chunkAccum;
          setMessages(prev => prev.map(m => m.id === streamingMsgId ? { ...m, content: contentSoFar } : m));
        },
        (patient) => {
          currentPatientRef.current = patient;
        },
        (waitSec) => {
          if (waitSec > 0) setRetryMessage(`Retrying in ${waitSec}s...`);
          else setRetryMessage('');
        }
      );

      const finalText = result.content || '';
      history.push({ role: 'assistant', content: finalText });

      const isCareGap = userMessage.toLowerCase().includes('care gap');
      const carePatientId = isCareGap ? currentPatientRef.current?.id : null;
      const hasCareGapContent = isCareGap && carePatientId && finalText.length > 500 && !finalText.toLowerCase().includes('could you please provide') && !finalText.toLowerCase().includes('which patient');
      if (hasCareGapContent) {
        try { sessionStorage.setItem('dashboard_caregap_' + carePatientId, finalText); } catch (_) {}
      }

      const extraProps = { userQuery: userMessage, showCareCordBtn: hasCareGapContent, patientId: carePatientId };

      if (streamingMsgId) {
        setMessages(prev => prev.map(m =>
          m.id === streamingMsgId ? { ...m, content: finalText, isStreaming: false, ...extraProps } : m
        ));
      } else {
        setIsTyping(false);
        addMessage('bot', finalText, extraProps);
      }
    } catch (err) {
      setIsTyping(false);
      addMessage('bot', `Sorry, I encountered an error: ${err.message}. Please try again.`);
      console.error('Agent error:', err);
    }
  }, [addMessage]);

  const handleSend = useCallback(async () => {
    const text = inputValue.trim();
    if (!text || isBotResponding) return;

    userScrolledUpRef.current = false;
    setInputValue('');
    if (inputRef.current) inputRef.current.style.height = 'auto';
    setIsBotResponding(true);
    addMessage('user', text);

    let internalQuery = text;
    if (pendingChipActionRef.current) {
      const action = pendingChipActionRef.current;
      pendingChipActionRef.current = null;

      let patientRef = text;
      if (currentPatientRef.current) {
        const typedLower = text.toLowerCase();
        const nameLower = currentPatientRef.current.name.toLowerCase();
        const firstName = nameLower.split(' ')[0];
        if (typedLower.includes(firstName) || typedLower === 'yes' || typedLower === 'yeah' || typedLower === 'same') {
          patientRef = currentPatientRef.current.id || currentPatientRef.current.name;
        }
      }

      const queries = {
        conditions: `Show active conditions for patient ${patientRef}`,
        lab: `Latest observations for the patient ${patientRef}`,
        medications: `List medications for patient ${patientRef}`,
        encounters: `Show encounters for patient ${patientRef}`,
        caregaps: `Show care gaps for patient ${patientRef}`,
      };
      internalQuery = queries[action] || text;
    }

    await agentLoop(internalQuery);
    setIsBotResponding(false);
    if (inputRef.current) inputRef.current.focus();
  }, [inputValue, isBotResponding, addMessage, agentLoop]);

  const handlePredefinedClick = useCallback(async (item) => {
    if (isBotResponding) return;
    userScrolledUpRef.current = false;
    setShowDropdown(false);
    addMessage('user', item.label);
    setIsBotResponding(true);
    if (item.action) {
      let patientRef = '';
      if (currentPatientRef.current) {
        patientRef = currentPatientRef.current.id || currentPatientRef.current.name;
      }
      const queries = {
        conditions: `Show active conditions for patient ${patientRef}`,
        lab: `Latest observations for the patient ${patientRef}`,
        medications: `List medications for patient ${patientRef}`,
        encounters: `Show encounters for patient ${patientRef}`,
        caregaps: `Show care gaps for patient ${patientRef}`,
      };
      await agentLoop(queries[item.action] || item.query || item.label);
    } else {
      await agentLoop(item.query || item.label);
    }
    setIsBotResponding(false);
    if (inputRef.current) inputRef.current.focus();
  }, [isBotResponding, addMessage, agentLoop]);

  const handleClearChat = useCallback(() => {
    conversationHistoryRef.current = [];
    currentPatientRef.current = null;
    pendingChipActionRef.current = null;
    setMessages([]);
    setShowWelcome(true);
  }, []);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const handleInputChange = useCallback((e) => {
    setInputValue(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 100) + 'px';
  }, []);

  const togglePanel = useCallback(() => {
    setIsPanelOpen(prev => !prev);
  }, []);

  return (
    <div id="chat-widget">
      <div id="chat-panel" ref={panelRef} className={`chat-panel ${!isPanelOpen ? 'hidden' : ''}`}>
        <div className="chat-resize-handle" onMouseDown={handleResizeStart} onTouchStart={handleResizeStart} title="Drag to resize">
          <svg width="12" height="12" viewBox="0 0 12 12"><path d="M1 11L11 1M5 11L11 5M9 11L11 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
        </div>
        <div className="chat-panel-header">
          <div className="chat-panel-info">
            <img src="/chatbot_image/chatbot.png" alt="CareBridge" className="panel-avatar" />
            <div>
              <span className="panel-name">RSICareBridge</span>
              <span className="panel-status"><span className="online-dot"></span>Online</span>
            </div>
          </div>
          <div className="panel-header-actions">
            <button className="panel-action-btn" title="Clear chat" onClick={handleClearChat}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6" /><path d="M14 11v6" />
              </svg>
            </button>
            <button className="panel-action-btn" title="Close" onClick={() => setIsPanelOpen(false)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        <div id="messages" className="messages-area" ref={messagesAreaRef} onScroll={handleMessagesScroll}>
          {showWelcome && messages.length === 0 && (
            <div className="welcome-card">
              <img src="/chatbot_image/chatbot.png" alt="CareBridge" />
              <h3>Hey {displayName}, how can I assist you today?</h3>
              <p>Search patient records, retrieve lab results, conditions, medications, encounters, and procedures.</p>
            </div>
          )}
          {messages.map((msg) => {
            const isBot = msg.role === 'bot';
            const { cleanText, chartData, allCharts } = isBot ? extractChartData(msg.content || '') : { cleanText: msg.content, chartData: null, allCharts: null };
            const showCareGapBtn = isBot && !msg.isStreaming && msg.userQuery && msg.userQuery.toLowerCase().includes('care gap');

            return (
              <div key={msg.id} className={`msg-row ${isBot ? 'bot' : 'user'}`}>
                {isBot ? (
                  <>
                    <div><img src="/chatbot_image/chatbot.png" alt="CareBridge" className="msg-avatar" /></div>
                    <div style={{ display: 'flex', flexDirection: 'column', maxWidth: '80%' }}>
                      <div className="msg-bubble">
                        <span dangerouslySetInnerHTML={{ __html: simpleMarkdown(cleanText) }} />
                        {allCharts && !msg.isStreaming && allCharts.map((cd, ci) => <ChartBlock key={ci} chartData={cd} />)}
                        {!allCharts && chartData && !msg.isStreaming && <ChartBlock chartData={chartData} />}
                        {msg.showCareCordBtn && (
                          <>
                            <br />
                            <button
                              style={{ display: 'inline-block', marginTop: '10px', padding: '6px 14px', background: 'transparent', color: '#0d9488', border: '1px solid #0d9488', borderRadius: '4px', fontSize: '0.85rem', cursor: 'pointer' }}
                              onMouseEnter={(e) => { e.target.style.background = '#0d9488'; e.target.style.color = '#fff'; }}
                              onMouseLeave={(e) => { e.target.style.background = 'transparent'; e.target.style.color = '#0d9488'; }}
                              onClick={() => {
                                const cbEmail = localStorage.getItem('cb_email') || ''
                                const dashUrl = msg.patientId
                                  ? `${window.location.origin}/dashboard?d=${btoa(msg.patientId + '|' + cbEmail)}`
                                  : `${window.location.origin}/dashboard`;
                                window.open(dashUrl, '_blank');
                              }}
                            >
                              Launch CareCord AI
                            </button>
                          </>
                        )}
                      </div>
                      <span className="msg-time">{msg.timestamp}</span>
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ display: 'flex', flexDirection: 'column', maxWidth: '80%' }}>
                      <div className="msg-bubble">{msg.content}</div>
                      <span className="msg-time">{msg.timestamp}</span>
                    </div>
                    <div className="msg-avatar user-av">{userInitial}</div>
                  </>
                )}
              </div>
            );
          })}
        </div>

        {isTyping && (
          <div className="typing-indicator">
            <img src="/chatbot_image/chatbot.png" alt="" className="typing-avatar" />
            <div className="typing-bubble">
              {retryMessage ? (
                <span style={{ fontSize: '11px', color: '#4a5568' }}>{retryMessage}</span>
              ) : (
                <><span className="dot"></span><span className="dot"></span><span className="dot"></span></>
              )}
            </div>
          </div>
        )}

        <div className="chat-input-bar">
          <div className="input-container">
            <textarea
              id="user-input"
              ref={inputRef}
              placeholder={isBotResponding ? 'CareBridge is responding...' : 'Ask about patient records, labs...'}
              rows="1"
              maxLength="2000"
              value={inputValue}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              disabled={isBotResponding}
            />
            <div className={`predefined-dropdown ${!showDropdown ? 'hidden' : ''}`}>
              {PREDEFINED_ITEMS.map((item) => (
                <div key={item.label} className="predefined-dropdown-item" onClick={() => handlePredefinedClick(item)}>
                  {item.label}
                </div>
              ))}
            </div>
            <button
              className={`bulb-btn ${showDropdown ? 'active' : ''}`}
              title="Predefined questions"
              onClick={(e) => { e.stopPropagation(); setShowDropdown(prev => !prev); }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="9" y1="18" x2="15" y2="18" />
                <line x1="10" y1="22" x2="14" y2="22" />
                <path d="M12 2a7 7 0 0 1 7 7c0 3-1.8 5.4-4.5 6.5V17H9.5v-1.5C6.8 14.4 5 12 5 9a7 7 0 0 1 7-7z" />
              </svg>
            </button>
            <button
              className="send-btn"
              disabled={isBotResponding || !inputValue.trim()}
              title="Send"
              onClick={handleSend}
            >
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
              </svg>
            </button>
          </div>
          <p className="input-hint">CareBridge retrieves FHIR R4 data. Never provides treatment recommendations.</p>
        </div>
      </div>

      <button className="chat-toggle-btn" title="Open CareBridge" onClick={togglePanel}>
        <img src="/chatbot_image/chatbot.png" alt="CareBridge" className={`toggle-icon-open ${isPanelOpen ? 'hidden' : ''}`} />
        <svg className={`toggle-icon-close ${!isPanelOpen ? 'hidden' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}
