// Small branding credit — bottom-right corner of the app's entry screens
// (sign-in and lobby). Uses the app's standard grey/font-size convention
// (#555, 11px, Roboto) so it reads as part of the UI, not an ad — except
// "X Spark" itself, which is in the app's signature gold (#f5a623) to tie
// the credit back to the brand.
export function BuiltByFooter() {
  return (
    <a
      href="https://www.xspark.co.za"
      target="_blank"
      rel="noopener noreferrer"
      style={{
        position: 'fixed', bottom: 12, right: 16, zIndex: 5,
        color: '#555', fontSize: 11, fontFamily: "'Roboto', sans-serif",
        fontWeight: 300, textDecoration: 'none',
      }}
    >
      Built by <span style={{ color: '#f5a623' }}>X Spark</span>
      {import.meta.env.VITE_APP_VERSION && (
        <span style={{ color: '#3a3a3a', marginLeft: 6 }}>v{import.meta.env.VITE_APP_VERSION}</span>
      )}
    </a>
  )
}
