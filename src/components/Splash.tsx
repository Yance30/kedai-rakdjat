/**
 * The single maroon launch screen. Used while the app loads and as the login intro,
 * so the two read as one screen (the Android splash uses the same colour).
 */
export default function Splash({ className = '' }: { className?: string }) {
  return (
    <div className={`grid place-items-center kr-shell ${className}`}>
      <div className="text-center">
        <div className="kr-breathe w-16 h-16 rounded-full border border-brass/60 grid place-items-center font-display font-bold text-brass-soft text-2xl mx-auto mb-4">KR</div>
        <div className="font-display font-semibold text-2xl text-white">Kedai Rakdjat</div>
      </div>
    </div>
  );
}
