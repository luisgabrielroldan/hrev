import { render } from 'preact';
import { App } from './components/App.tsx';
import { start } from './store.ts';
import './styles.css';

const root = document.getElementById('app')!;
root.textContent = '';
render(<App />, root);
start();
