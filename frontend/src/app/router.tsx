import { createBrowserRouter } from 'react-router-dom'

import AppLayout from '../components/layout/AppLayout'
import AICoachPage from '../pages/AICoachPage'
import DashboardPage from '../pages/DashboardPage'
import LoginPage from '../pages/LoginPage'
import NutritionPage from '../pages/NutritionPage'
import ProgressPage from '../pages/ProgressPage'
import SettingsPage from '../pages/SettingsPage'
import SignupPage from '../pages/SignupPage'
import WorkoutPage from '../pages/WorkoutPage'

const router = createBrowserRouter([
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    path: '/signup',
    element: <SignupPage />,
  },
  {
    element: <AppLayout />,
    children: [
      {
        path: '/',
        element: <DashboardPage />,
      },
      {
        path: '/progress',
        element: <ProgressPage />,
      },
      {
        path: '/nutrition',
        element: <NutritionPage />,
      },
      {
        path: '/workout',
        element: <WorkoutPage />,
      },
      {
        path: '/ai-coach',
        element: <AICoachPage />,
      },
      {
        path: '/settings',
        element: <SettingsPage />,
      },
    ],
  },
])

export default router