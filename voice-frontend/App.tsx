import React from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import { Editor } from './pages/Editor.tsx';
import { History } from './pages/History.tsx';

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Editor />} />
        <Route path="/history" element={<History />} />
      </Routes>
    </HashRouter>
  );
}