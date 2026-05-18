import { useState } from "react";
import { motion } from "framer-motion";

const MODELS = [
  { name: "Llama 3.2 1B", params: "1B", speed: "120 t/s", vram: "1.2 GB" },
  { name: "Qwen 2.5 1.5B", params: "1.5B", speed: "105 t/s", vram: "1.4 GB" },
  { name: "Phi 3.5 Mini", params: "3.8B", speed: "65 t/s", vram: "2.8 GB" },
  { name: "Llama 3.1 8B", params: "8B", speed: "25 t/s", vram: "5.5 GB" }
];

export function ModelStatsPicker() {
  const [activeModel, setActiveModel] = useState(MODELS[0]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center bg-card border border-border p-8 rounded-2xl relative overflow-hidden">
      <div className="absolute -inset-[100%] bg-gradient-to-r from-transparent via-primary/5 to-transparent animate-[spin_10s_linear_infinite]" />
      
      <div className="relative z-10 flex flex-col gap-2">
        <h3 className="text-2xl font-bold mb-4">Select your engine.</h3>
        {MODELS.map((model) => (
          <button
            key={model.name}
            onMouseEnter={() => setActiveModel(model)}
            onClick={() => setActiveModel(model)}
            className={`text-left px-4 py-3 rounded-lg border font-mono transition-all duration-300 ${
              activeModel.name === model.name 
                ? "border-primary bg-primary/10 text-primary shadow-[0_0_15px_hsl(var(--primary)/0.2)]" 
                : "border-transparent text-muted-foreground hover:text-foreground hover:bg-white/5"
            }`}
          >
            {model.name}
          </button>
        ))}
      </div>

      <div className="relative z-10 grid grid-cols-2 gap-4">
        <div className="p-4 bg-background border border-border rounded-lg">
          <div className="text-xs text-muted-foreground mb-1 font-mono">PARAMETERS</div>
          <motion.div 
            key={activeModel.params}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-3xl font-bold text-foreground"
          >
            {activeModel.params}
          </motion.div>
        </div>
        <div className="p-4 bg-background border border-border rounded-lg">
          <div className="text-xs text-muted-foreground mb-1 font-mono">EST. SPEED</div>
          <motion.div 
            key={activeModel.speed}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-3xl font-bold text-primary"
          >
            {activeModel.speed}
          </motion.div>
        </div>
        <div className="p-4 bg-background border border-border rounded-lg col-span-2">
          <div className="text-xs text-muted-foreground mb-1 font-mono">VRAM REQUIREMENT</div>
          <motion.div 
            key={activeModel.vram}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-3xl font-bold text-foreground"
          >
            {activeModel.vram}
          </motion.div>
        </div>
      </div>
    </div>
  );
}
