package ws

import (
	"log"
	"time"

	"github.com/gofiber/websocket/v2"
)

const (
	writeWait  = 10 * time.Second
	pongWait   = 60 * time.Second
	pingPeriod = (pongWait * 9) / 10
)

// Client wraps one live tape WebSocket connection. All writes to the
// connection go through out so a single goroutine (WritePump) owns the
// conn — fasthttp/websocket connections aren't safe for concurrent writes.
type Client struct {
	conn *websocket.Conn
	out  chan []byte
}

func NewClient(conn *websocket.Conn) *Client {
	return &Client{conn: conn, out: make(chan []byte, 16)}
}

// Send enqueues a message for delivery. Never blocks: a client slow enough
// to fill its buffer gets a dropped message rather than stalling the hub's
// broadcast to every other subscriber.
func (c *Client) Send(msg []byte) {
	select {
	case c.out <- msg:
	default:
		log.Printf("ws: client buffer full, dropping tape message")
	}
}

// Close signals WritePump to stop. Safe to call once per client.
func (c *Client) Close() {
	close(c.out)
}

// WritePump drains c.out to the connection and pings periodically to keep
// the connection alive through idle intermediaries. Returns when c.out is
// closed or a write fails; the caller should treat return as "connection
// gone".
func (c *Client) WritePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()
	for {
		select {
		case msg, ok := <-c.out:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// ReadPump drains incoming frames (the client never sends anything
// meaningful — this only exists to detect pong/close) and blocks until the
// connection ends.
func (c *Client) ReadPump() {
	c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})
	for {
		if _, _, err := c.conn.ReadMessage(); err != nil {
			return
		}
	}
}
