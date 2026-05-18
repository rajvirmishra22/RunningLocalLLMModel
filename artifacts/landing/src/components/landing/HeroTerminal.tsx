import { useState, useEffect } from "react";
import { motion } from "framer-motion";

const prompts = [
  "> INITIALIZING LOCALMODEL STUDIO...",
  "> LOADING WEBGPU ENGINE...",
  "> ALLOCATING VRAM...",
  "> MODEL LOADED. READY FOR INPUT.",
  "> User: Write a function to reverse a string in Rust.",
  "> Assistant: Here is a concise way to reverse a string in Rust:",
  "> ```rust",
  "> fn reverse_string(s: &str) -> String {",
  ">     s.chars().rev().collect()",
  "> }",
  "> ```"
];

export function HeroTerminal() {
  const [text, setText] = useState("");
  const [lineIndex, setLineIndex] = useState(0);
  const [charIndex, setCharIndex] = useState(0);

  useEffect(() => {
    if (lineIndex >= prompts.length) return;

    const currentLine = prompts[lineIndex];

    if (charIndex < currentLine.length) {
      const timeout = setTimeout(() => {
        setText((prev) => prev + currentLine[charIndex]);
        setCharIndex(charIndex + 1);
      }, Math.random() * 30 + 10);
      return () => clearTimeout(timeout);
    } else {
      const timeout = setTimeout(() => {
        setText((prev) => prev + "\n");
        setLineIndex(lineIndex + 1);
        setCharIndex(0);
      }, 500);
      return () => clearTimeout(timeout);
    }
  }, [charIndex, lineIndex]);

  return (
    <div className="w-full max-w-lg mx-auto bg-black/50 border border-primary/20 rounded-lg p-4 font-mono text-sm shadow-[0_0_20px_hsl(var(--primary)/0.1)] relative overflow-hidden h-[240px] text-left">
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary to-transparent opacity-50" />
      <div className="flex items-center gap-2 mb-4 border-b border-primary/20 pb-2">
        <div className="w-3 h-3 rounded-full bg-red-500/50" />
        <div className="w-3 h-3 rounded-full bg-yellow-500/50" />
        <div className="w-3 h-3 rounded-full bg-green-500/50" />
        <span className="text-muted-foreground ml-2 text-xs">local-engine.exe</span>
      </div>
      <div className="whitespace-pre-wrap text-primary/80">
        {text}
        <motion.span 
          animate={{ opacity: [1, 0] }} 
          transition={{ repeat: Infinity, duration: 0.8 }}
          className="inline-block w-2 h-4 bg-primary align-middle ml-1"
        />
      </div>
    </div>
  );
}
