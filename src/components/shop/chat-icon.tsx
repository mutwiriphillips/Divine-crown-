/** Generic speech-bubble-with-handset icon used for WhatsApp links. */
export function ChatIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4.5 19.5l1.1-3.6A8 8 0 1 1 8.4 18.6z" />
      <path d="M9.2 9.1c.2 2 1.7 3.6 3.7 4.1l.9-.9 1.6.6-.3 1.5c-3.3.2-6.4-2.8-6.3-6.2l1.5-.3.6 1.6z" fill="currentColor" stroke="none" />
    </svg>
  );
}
