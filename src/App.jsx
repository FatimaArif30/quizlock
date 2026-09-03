import { Routes, Route } from 'react-router-dom'
import Home from './pages/Home'
import TeacherLogin from './pages/TeacherLogin'
import TeacherDashboard from './pages/TeacherDashboard'
import QuizFlow from './pages/QuizFlow'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/teacher/login" element={<TeacherLogin />} />
      <Route path="/teacher" element={<TeacherDashboard />} />
      <Route path="/quiz/:quizId" element={<QuizFlow />} />
      <Route path="*" element={<Home />} />
    </Routes>
  )
}
