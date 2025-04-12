import React, { useState, useRef, useEffect } from "react";
import axios from "axios";
import ReactMarkdown from "react-markdown";
import "./App.css";

function App() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const messagesRef = useRef(null); // Ref for the .messages container

  const scrollToBottom = () => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim()) return;

    const userMessage = { sender: "user", text: input };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");

    try {
      const res = await axios.post("http://localhost:5000/chat", {
        message: input,
      });
      const botMessage = { sender: "bot", text: res.data.reply };
      setMessages((prev) => [...prev, botMessage]);
    } catch (err) {
      console.error(err);
      const errorMessage = {
        sender: "bot",
        text: "Oops! Something went wrong.",
      };
      setMessages((prev) => [...prev, errorMessage]);
    }
  };

  return (
    <div className="app">
      <div className="chat-box">
        <h2>💬 Smart Assistant</h2>
        <div className="messages" ref={messagesRef}>
          {messages.map((msg, idx) => (
            <div
              key={idx}
              className={`message ${msg.sender === "user" ? "user" : "bot"}`}
            >
              {msg.sender === "bot" ? (
                <div className="bot-message-wrapper">
                  <div className="bot-avatar">🤖</div>
                  <div className="message-content bot-bubble">
                    <ReactMarkdown
                      components={{
                        a: ({ node, ...props }) => (
                          <a
                            {...props}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="markdown-link"
                            aria-label={`Go to ${props.children[0]}`} // Adds accessible text
                          >
                            {props.children}
                          </a>
                        ),
                      }}
                    >
                      {msg.text}
                    </ReactMarkdown>
                  </div>
                </div>
              ) : (
                <div className="message-content user-bubble">{msg.text}</div>
              )}
            </div>
          ))}
        </div>
        <div className="input-area">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            placeholder="Type your message..."
          />
          <button onClick={handleSend}>➤</button>
        </div>
      </div>
    </div>
  );
}

export default App;

