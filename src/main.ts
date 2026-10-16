import { mount } from 'svelte';
import App from './App.svelte';
import './typography.css';
import './style.css';
mount(App, { target: document.getElementById('app')! });
