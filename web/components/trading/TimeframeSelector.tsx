import { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';

interface TimeframeSelectorProps {
    selected: string;
    onSelect: (interval: string) => void;
}

const TIMEFRAMES = [
    { label: '1m', value: '1' },
    { label: '5m', value: '5' },
    { label: '15m', value: '15' },
    { label: '30m', value: '30' },
    { label: '1h', value: '60' },
    { label: '4h', value: '240' },
    { label: '1d', value: 'D' },
    { label: '1w', value: 'W' }
];

export default function TimeframeSelector({ selected, onSelect }: TimeframeSelectorProps) {
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const selectedLabel = TIMEFRAMES.find(t => t.value === selected)?.label || selected;

    return (
        <div className="relative" ref={containerRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center gap-1.5 bg-gray-900/80 border border-gray-700/50 hover:border-gray-600 rounded-lg px-3 py-1.5 text-sm font-bold transition-all text-gray-200 hover:text-white min-w-[70px] justify-between"
            >
                <span>{selectedLabel}</span>
                <ChevronDown className={`w-3 h-3 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {isOpen && (
                <div className="absolute top-full right-0 mt-1 w-32 bg-gray-900 border border-gray-800 rounded-lg shadow-xl overflow-hidden z-[100] py-1 backdrop-blur-md">
                    <div className="grid grid-cols-2 gap-0.5 p-1">
                        {TIMEFRAMES.map((tf) => (
                            <button
                                key={tf.value}
                                onClick={() => {
                                    onSelect(tf.value);
                                    setIsOpen(false);
                                }}
                                className={`px-2 py-1.5 text-xs font-medium rounded hover:bg-gray-800 transition-colors text-center ${selected === tf.value
                                    ? 'bg-blue-500/20 text-blue-400'
                                    : 'text-gray-400 hover:text-gray-200'
                                    }`}
                            >
                                {tf.label}
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
