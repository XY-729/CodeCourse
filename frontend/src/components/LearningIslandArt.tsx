/** Decorative geometry only: no assets, requests, or animation loop. */
export default function LearningIslandArt({ small = false }: { small?: boolean }) {
  return <svg className={`learning-island-art ${small ? "is-small" : ""}`} viewBox="0 0 260 180" fill="none" aria-hidden="true">
    <ellipse cx="129" cy="145" rx="78" ry="13" fill="currentColor" opacity=".08" />
    <ellipse cx="131" cy="102" rx="106" ry="43" transform="rotate(-16 131 102)" stroke="currentColor" opacity=".3" strokeDasharray="3 7" />
    <path d="M54 106L129 139L203 105L182 131L130 158L77 134Z" fill="currentColor" opacity=".18" />
    <path d="M54 106L125 77L203 105L129 139Z" fill="currentColor" opacity=".3" />
    <path d="M75 68C94 64 108 69 129 80L129 122C109 110 92 106 75 111Z" fill="var(--apple-surface)" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
    <path d="M129 80C151 66 168 62 187 67L187 110C166 105 149 111 129 122Z" fill="var(--apple-surface)" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
    <path d="M87 80L113 88M87 91L112 99M145 87L173 78M145 98L165 91" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity=".3" />
    <path d="M157 70L170 66V93L163 90L157 97Z" fill="var(--room-art-accent, #eaa35f)" />
    <path d="M66 34L70 44L80 48L70 52L66 62L62 52L52 48L62 44Z" fill="var(--room-art-accent, #eaa35f)" />
    <path d="M205 45L208 52L215 55L208 58L205 65L202 58L195 55L202 52Z" fill="currentColor" opacity=".7" />
    <circle cx="38" cy="100" r="5" fill="currentColor" opacity=".7" />
    <circle cx="223" cy="117" r="4" fill="var(--room-art-accent, #eaa35f)" />
    <circle cx="123" cy="32" r="3" fill="currentColor" opacity=".4" />
  </svg>;
}
