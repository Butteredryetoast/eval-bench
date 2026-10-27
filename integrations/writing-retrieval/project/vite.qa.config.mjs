import {defineConfig,mergeConfig} from 'vite';
import base from './vite.config.mjs';
export default mergeConfig(base,defineConfig({server:{port:5174,strictPort:true,proxy:{'/api':'http://127.0.0.1:8788'}}}));
