import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import RoomPage from '../RoomPage'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RoomPage />
  </StrictMode>
)
