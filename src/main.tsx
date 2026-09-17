import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AuthGate } from '../components/AuthGate'
import RoomPage from '../RoomPage'
import { UpdatePrompt } from '../components/UpdatePrompt'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthGate>
      <RoomPage />
    </AuthGate>
    {/* Rendered outside AuthGate so it works even before auth completes */}
    <UpdatePrompt />
  </StrictMode>
)
