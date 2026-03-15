import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Volume2, Star, Lightbulb } from 'lucide-react';

interface FlashcardProps {
  cardId: number;
  frontText: string;
  backText: string;
  isStarred: boolean;
  onToggleStar: (id: number) => void;
}

export default function Flashcard({ cardId, frontText, backText, isStarred, onToggleStar }: FlashcardProps) {
  const [isFlipped, setIsFlipped] = useState(false);
  const [showHint, setShowHint] = useState(false);

  // Kart değiştiğinde yüzünü ve ipucunu sıfırla
  useEffect(() => {
    setIsFlipped(false);
    setShowHint(false);
  }, [cardId]);

  // SPAM ENGELLEYİCİ SES SİSTEMİ
  const speak = (e: React.MouseEvent, text: string, lang: string = 'en-US') => {
    e.stopPropagation(); 
    window.speechSynthesis.cancel(); // Önceki okunan tüm sesleri anında keser!
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang; 
    window.speechSynthesis.speak(utterance);
  };

  const handleStarClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleStar(cardId);
  };

  const handleHintClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowHint(true);
  };

  return (
    <div className="w-full max-w-3xl h-96 cursor-pointer perspective-1000 relative group" onClick={() => setIsFlipped(!isFlipped)}>
      <motion.div
        className="relative w-full h-full transform-style-3d"
        initial={false}
        animate={{ rotateX: isFlipped ? 180 : 0 }}
        transition={{ duration: 0.5, type: "spring", stiffness: 260, damping: 20 }}
      >
        {/* ÖN YÜZ */}
        <div className="absolute inset-0 backface-hidden bg-[#2e3856] rounded-2xl shadow-xl flex flex-col p-8 border border-white/5">
          <div className="flex justify-between items-start w-full text-slate-400">
            <button onClick={handleHintClick} className="hover:text-yellow-300 transition-colors flex items-center gap-2 text-sm">
              <Lightbulb size={20}/> İpucu
            </button>
            <div className="flex gap-5">
              <button onClick={(e) => speak(e, frontText, 'en-US')} className="hover:text-white transition-colors"><Volume2 size={22}/></button>
              <button onClick={handleStarClick} className={`transition-colors ${isStarred ? 'text-yellow-400' : 'hover:text-white'}`}><Star size={22} fill={isStarred ? 'currentColor' : 'none'}/></button>
            </div>
          </div>
          <div className="flex-1 flex flex-col items-center justify-center">
            <p className="text-5xl font-medium text-white text-center">{frontText}</p>
            {/* İpucu Göstergesi */}
            {showHint && (
              <p className="mt-6 text-yellow-400 font-medium text-xl bg-yellow-400/10 px-4 py-2 rounded-lg border border-yellow-400/20">
                İpucu: {backText.substring(0, Math.max(2, Math.floor(backText.length / 3)))}...
              </p>
            )}
          </div>
        </div>

        {/* ARKA YÜZ */}
        <div className="absolute inset-0 backface-hidden bg-[#2e3856] rounded-2xl shadow-xl flex flex-col p-8 border border-white/5" style={{ transform: 'rotateX(180deg)' }}>
          <div className="flex justify-end w-full text-slate-400">
            <div className="flex gap-5">
              <button onClick={(e) => speak(e, backText, 'tr-TR')} className="hover:text-white transition-colors"><Volume2 size={22}/></button>
              <button onClick={handleStarClick} className={`transition-colors ${isStarred ? 'text-yellow-400' : 'hover:text-white'}`}><Star size={22} fill={isStarred ? 'currentColor' : 'none'}/></button>
            </div>
          </div>
          <div className="flex-1 flex items-center justify-center">
            <p className="text-5xl font-medium text-white text-center">{backText}</p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}