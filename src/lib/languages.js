// Languages offered for code questions.
//   monaco = editor highlighting id   ·   piston = run-service language id
export const LANGS = [
  { label: 'Python',     monaco: 'python',     piston: 'python' },
  { label: 'JavaScript', monaco: 'javascript', piston: 'javascript' },
  { label: 'TypeScript', monaco: 'typescript', piston: 'typescript' },
  { label: 'Java',       monaco: 'java',       piston: 'java' },
  { label: 'C',          monaco: 'c',          piston: 'c' },
  { label: 'C++',        monaco: 'cpp',        piston: 'c++' },
  { label: 'C#',         monaco: 'csharp',     piston: 'csharp' },
  { label: 'Go',         monaco: 'go',         piston: 'go' },
  { label: 'Ruby',       monaco: 'ruby',       piston: 'ruby' },
  { label: 'PHP',        monaco: 'php',        piston: 'php' },
  { label: 'Rust',       monaco: 'rust',       piston: 'rust' },
  { label: 'Kotlin',     monaco: 'kotlin',     piston: 'kotlin' },
  { label: 'Swift',      monaco: 'swift',      piston: 'swift' },
  { label: 'Bash',       monaco: 'shell',      piston: 'bash' },
  { label: 'SQL (SQLite)', monaco: 'sql',      piston: 'sqlite3' },
]

export const langByMonaco = (id) => LANGS.find((l) => l.monaco === id) || LANGS[0]
