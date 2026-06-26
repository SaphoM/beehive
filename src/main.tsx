import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AuthGate } from '../components/AuthGate'
import RoomPage from '../RoomPage'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthGate>
      <RoomPage />
    </AuthGate>
  </StrictMode>
)
