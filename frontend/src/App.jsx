import { useState, useEffect } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || '';

export default function App() {
  const [todos, setTodos] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_BASE}/api/todos`)
      .then((r) => r.json())
      .then(setTodos)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  async function addTodo(e) {
    e.preventDefault();
    if (!input.trim()) return;
    const res = await fetch(`${API_BASE}/api/todos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: input.trim() }),
    });
    const todo = await res.json();
    setTodos([todo, ...todos]);
    setInput('');
  }

  async function toggleTodo(id) {
    const res = await fetch(`${API_BASE}/api/todos/${id}`, { method: 'PATCH' });
    const updated = await res.json();
    setTodos(todos.map((t) => (t.id === id ? updated : t)));
  }

  async function deleteTodo(id) {
    await fetch(`${API_BASE}/api/todos/${id}`, { method: 'DELETE' });
    setTodos(todos.filter((t) => t.id !== id));
  }

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>Todo App</h1>
      <form onSubmit={addTodo} style={styles.form}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="What needs to be done?"
          style={styles.input}
          autoFocus
        />
        <button type="submit" style={styles.addBtn}>Add</button>
      </form>
      {loading ? (
        <p style={styles.loading}>Loading...</p>
      ) : todos.length === 0 ? (
        <p style={styles.empty}>No todos yet. Add one above!</p>
      ) : (
        <ul style={styles.list}>
          {todos.map((todo) => (
            <li key={todo.id} style={styles.item}>
              <label style={styles.label}>
                <input
                  type="checkbox"
                  checked={todo.completed}
                  onChange={() => toggleTodo(todo.id)}
                  style={styles.checkbox}
                />
                <span style={{
                  ...styles.text,
                  textDecoration: todo.completed ? 'line-through' : 'none',
                  opacity: todo.completed ? 0.5 : 1,
                }}>
                  {todo.title}
                </span>
              </label>
              <button onClick={() => deleteTodo(todo.id)} style={styles.deleteBtn}>
                x
              </button>
            </li>
          ))}
        </ul>
      )}
      <p style={styles.footer}>{todos.filter((t) => !t.completed).length} items left</p>
    </div>
  );
}

const styles = {
  container: {
    maxWidth: 500,
    margin: '60px auto',
    padding: '0 20px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  title: {
    textAlign: 'center',
    color: '#333',
    fontSize: 32,
    marginBottom: 24,
  },
  form: {
    display: 'flex',
    gap: 8,
    marginBottom: 24,
  },
  input: {
    flex: 1,
    padding: '12px 16px',
    fontSize: 16,
    border: '2px solid #ddd',
    borderRadius: 8,
    outline: 'none',
  },
  addBtn: {
    padding: '12px 24px',
    fontSize: 16,
    background: '#4f46e5',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
  },
  list: {
    listStyle: 'none',
    padding: 0,
    margin: 0,
  },
  item: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 0',
    borderBottom: '1px solid #eee',
  },
  label: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    cursor: 'pointer',
    flex: 1,
  },
  checkbox: {
    width: 20,
    height: 20,
    cursor: 'pointer',
  },
  text: {
    fontSize: 16,
    transition: 'all 0.2s',
  },
  deleteBtn: {
    background: 'none',
    border: 'none',
    color: '#e53e3e',
    fontSize: 18,
    cursor: 'pointer',
    padding: '4px 8px',
  },
  loading: { textAlign: 'center', color: '#999' },
  empty: { textAlign: 'center', color: '#999', fontStyle: 'italic' },
  footer: { textAlign: 'center', color: '#999', marginTop: 16, fontSize: 14 },
};
