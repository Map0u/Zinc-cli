import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { SettingsProvider } from './settings/SettingsContext'
import { I18nProvider } from './i18n/I18nContext'
import { UpdateProvider } from './update/UpdateContext'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SettingsProvider>
      <I18nProvider>
        <UpdateProvider>
          <App />
        </UpdateProvider>
      </I18nProvider>
    </SettingsProvider>
  </React.StrictMode>
)
