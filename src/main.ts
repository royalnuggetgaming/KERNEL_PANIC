/** Entry point: UI styles (base, hud, screens in that order), the fatal error overlay, then the game. */
import './ui/styles/base.css';
import './ui/styles/hud.css';
import './ui/styles/screens.css';
import { createBrowserPlatform, createServices } from './app/createServices';
import { installErrorOverlay } from './app/errorOverlay';
import { createGame } from './app/Game';

const platform = createBrowserPlatform();
installErrorOverlay(platform);
createGame(createServices(platform)).start();
