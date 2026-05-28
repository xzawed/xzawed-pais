import '@testing-library/jest-dom/vitest'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

void i18n.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  ns: ['ui'],
  defaultNS: 'ui',
  interpolation: { escapeValue: false },
  resources: {
    en: {
      ui: {
        login: {
          title: 'Sign In',
          email: 'Email',
          password: 'Password',
          submit: 'Sign In',
          go_register: 'Register',
          error_invalid: 'Invalid email or password.',
        },
        register: {
          title: 'Sign Up',
          email: 'Email',
          password: 'Password',
          submit: 'Sign Up',
          go_login: 'Sign In',
          error_exists: 'Email already in use.',
        },
        projects: {
          title: 'Projects',
          new_project: 'New Project',
          logout: 'Logout',
          empty: 'No projects registered.',
        },
      },
    },
  },
})
