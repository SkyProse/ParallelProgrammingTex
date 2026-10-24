import {defineConfig,devices} from '@playwright/test';
export default defineConfig({
 testDir:'./e2e',fullyParallel:false,workers:1,timeout:45000,
 expect:{timeout:10000},reporter:[['list'],['html',{open:'never'}]],
 use:{baseURL:'http://127.0.0.1:5173',trace:'retain-on-failure',screenshot:'only-on-failure'},
 projects:[{name:'chromium',use:{...devices['Desktop Chrome'],launchOptions:{args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--enable-unsafe-webgpu']}}}],
 webServer:{command:'node scripts/serve.mjs',url:'http://127.0.0.1:5173',reuseExistingServer:!process.env.CI}
});
