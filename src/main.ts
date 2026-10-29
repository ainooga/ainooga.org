import App from './App.svelte';
import { mount } from 'svelte';
import { legacyHashPath } from '$lib/routing';

const legacyPath = legacyHashPath(window.location.hash);
if (legacyPath !== null) window.history.replaceState(null, '', legacyPath);

mount(App, { target: document.getElementById('app')! });
