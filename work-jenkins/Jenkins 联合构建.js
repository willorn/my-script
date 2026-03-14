// ==UserScript==
// @name         Jenkins 联合构建 (v7.3 - 全并行模式)
// @namespace    http://tampermonkey.net/
// @version      7.3
// @description  [优化] 步骤2改为并行触发。Common/API 完成后，同时触发 Bill/Customer/System/Report。
// @author       Tandy (修改 by Gemini)
// @match        http://10.9.31.83:9001/job/sz-newcis-dev/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @license      MIT
// @run-at       document-idle
// @downloadURL https://update.greasyfork.org/scripts/553550/Jenkins%20%E8%81%94%E5%90%88%E6%9E%84%E5%BB%BA%20%28v73%20-%20%E5%85%A8%E5%B9%B6%E8%A1%8C%E6%A8%A1%E5%BC%8F%29.user.js
// @updateURL https://update.greasyfork.org/scripts/553550/Jenkins%20%E8%81%94%E5%90%88%E6%9E%84%E5%BB%BA%20%28v73%20-%20%E5%85%A8%E5%B9%B6%E8%A1%8C%E6%A8%A1%E5%BC%8F%29.meta.js
// ==/UserScript==

(function() {
    'use strict';

    // -----------------------------------------------------------------
    //  v7.3 更新日志:
    //  1. [流程] 步骤 2 改为并行触发 (Bill, Customer, System, Report 同时开始)。
    //  2. [UI] 优化了步骤日志显示，现在支持多个并行阶段的动态显示。
    // -----------------------------------------------------------------

    // =================================================================
    // ⚙️ [配置区] ⚙️
    // =================================================================

    // 默认配置
    const DEFAULT_CONFIG = {
        triggerMaxRetries: 3,
        triggerRetryDelay: 2000,
        jobs: {
            'common': {
                name: 'Common',
                url: 'http://10.9.31.83:9001/job/sz-newcis-dev/job/sz-newcis-dev_cis-common/build?delay=0sec',
                enabled: true
            },
            'api': {
                name: 'API',
                url: 'http://10.9.31.83:9001/job/sz-newcis-dev/job/sz-newcis-dev_cis-api/build?delay=0sec',
                enabled: true
            },
            'web': {
                name: 'Web',
                url: 'http://10.9.31.83:9001/job/sz-newcis-dev/job/sz-newcis-dev_cis-web/build?delay=0sec',
                enabled: true
            },
            'bill': {
                name: 'Bill Service',
                url: 'http://10.9.31.83:9001/job/sz-newcis-dev/job/sz-newcis-dev_cis-bill-service/build?delay=0sec',
                enabled: true
            },
            'customer': {
                name: 'Customer Service',
                url: 'http://10.9.31.83:9001/job/sz-newcis-dev/job/sz-newcis-dev_cis-customer-service/build?delay=0sec',
                enabled: true
            },
            'system': {
                name: 'System Service',
                url: 'http://10.9.31.83:9001/job/sz-newcis-dev/job/sz-newcis-dev_cis-system-service/build?delay=0sec',
                enabled: true
            },
            'report': {
                name: 'Report Service',
                url: 'http://10.9.31.83:9001/job/sz-newcis-dev/job/sz-newcis-dev_cis-report-service/build?delay=0sec',
                enabled: true
            }
        }
    };

    // 运行时配置（会从存储加载）
    let CONFIG = JSON.parse(JSON.stringify(DEFAULT_CONFIG));

    // 重试配置（从 CONFIG 获取，会在 loadConfig 后更新）
    let TRIGGER_MAX_RETRIES = CONFIG.triggerMaxRetries;
    let TRIGGER_RETRY_DELAY = CONFIG.triggerRetryDelay;

    // Job 定义（从 CONFIG 获取，会在 loadConfig 后更新）
    let JOB_DEFINITIONS = CONFIG.jobs;

    // 立即加载配置（在任何 UI 创建之前）
    (function earlyLoadConfig() {
        try {
            if (typeof GM_getValue !== 'undefined') {
                const savedConfig = GM_getValue('jenkinsBuilderConfig');
                if (savedConfig) {
                    const parsedConfig = JSON.parse(savedConfig);
                    // 深拷贝合并配置
                    CONFIG = JSON.parse(JSON.stringify({ ...DEFAULT_CONFIG, ...parsedConfig }));
                    // 更新运行时变量
                    TRIGGER_MAX_RETRIES = CONFIG.triggerMaxRetries;
                    TRIGGER_RETRY_DELAY = CONFIG.triggerRetryDelay;
                    JOB_DEFINITIONS = CONFIG.jobs;
                    console.log('配置预加载成功:', CONFIG);
                }
            }
        } catch (error) {
            console.error('配置预加载失败，使用默认配置:', error);
        }
    })();

    const PIPELINE_STEPS = [
        // 步骤 1: 基础服务 (需要等待构建完成)
        {
            type: 'parallel-wait',
            jobs: [
                { key: 'common', wait: true }, // 阻塞
                { key: 'api', wait: true },    // 阻塞
                { key: 'web', wait: false }    // 不阻塞
            ]
        },
        // 步骤 2: 业务服务 (改为并行触发，不等待结果)
        {
            type: 'parallel-wait',
            jobs: [
                { key: 'bill', wait: false },
                { key: 'customer', wait: false },
                { key: 'system', wait: false },
                { key: 'report', wait: false }
            ]
        }
    ];

    // =================================================================
    // 🔚 [配置区结束]
    // =================================================================

    // --- 1. 定义全局 UI 元素和状态标志 ---
    let panelTitle, progressBar, progressContainer, stepContainer;
    let combinedButton, cancelButton;
    let isBuildCancelled = false;
    const PANEL_TITLE_DEFAULT = '🚀 联合构建 (v7.3)';

    class BuildChainError extends Error {
        constructor(message) {
            super(message);
            this.name = 'BuildChainError';
        }
    }

    // --- 2. 配置管理函数 ---

    function saveConfig() {
        try {
            if (typeof GM_setValue !== 'undefined') {
                const configString = JSON.stringify(CONFIG);
                GM_setValue('jenkinsBuilderConfig', configString);

                // 验证保存是否成功
                const verification = GM_getValue('jenkinsBuilderConfig');
                if (verification !== configString) {
                    throw new Error('配置验证失败：保存的数据与预期不符');
                }

                // 更新运行时变量
                TRIGGER_MAX_RETRIES = CONFIG.triggerMaxRetries;
                TRIGGER_RETRY_DELAY = CONFIG.triggerRetryDelay;
                JOB_DEFINITIONS = CONFIG.jobs;
                console.log('配置保存并验证成功:', CONFIG);
                return true;
            } else {
                throw new Error('GM_setValue 不可用');
            }
        } catch (error) {
            console.error('保存配置失败:', error);
            return false;
        }
    }

    function resetConfig() {
        CONFIG = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
        return saveConfig();
    }

    // --- 3. 配置 UI 函数 ---

    function createConfigUI() {
        // 创建遮罩层和配置面板
        const overlay = document.createElement('div');
        overlay.id = 'gm-config-overlay';
        overlay.innerHTML = `
            <div id="gm-config-modal">
                <div id="gm-config-header">
                    <h2>⚙️ Jenkins 构建配置</h2>
                    <button id="gm-config-close">&times;</button>
                </div>
                <div id="gm-config-body">
                    <!-- 基础配置 -->
                    <div class="gm-config-section">
                        <h3>基础配置</h3>
                        <div class="gm-config-field">
                            <label>最大重试次数</label>
                            <input type="number" id="gm-cfg-maxRetries" min="1" max="10" />
                        </div>
                        <div class="gm-config-field">
                            <label>重试延迟 (毫秒)</label>
                            <input type="number" id="gm-cfg-retryDelay" min="1000" max="10000" step="1000" />
                        </div>
                    </div>

                    <!-- Job 配置 -->
                    <div class="gm-config-section">
                        <h3>Job 配置</h3>
                        <div id="gm-job-list"></div>
                    </div>
                </div>
                <div id="gm-config-footer">
                    <button id="gm-config-reset">恢复默认</button>
                    <button id="gm-config-cancel">取消</button>
                    <button id="gm-config-save">保存</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        // 绑定事件
        document.getElementById('gm-config-close').onclick = closeConfig;
        document.getElementById('gm-config-cancel').onclick = closeConfig;
        document.getElementById('gm-config-save').onclick = saveConfigFromUI;
        document.getElementById('gm-config-reset').onclick = resetConfigUI;

        // 点击遮罩层关闭
        overlay.onclick = (e) => {
            if (e.target === overlay) closeConfig();
        };
    }

    function openConfig() {
        const overlay = document.getElementById('gm-config-overlay');
        if (!overlay) return;

        // 加载当前配置到 UI
        document.getElementById('gm-cfg-maxRetries').value = CONFIG.triggerMaxRetries;
        document.getElementById('gm-cfg-retryDelay').value = CONFIG.triggerRetryDelay;

        // 生成 Job 列表
        const jobList = document.getElementById('gm-job-list');
        jobList.innerHTML = '';
        for (const [key, job] of Object.entries(CONFIG.jobs)) {
            const jobItem = document.createElement('div');
            jobItem.className = 'gm-job-item';
            jobItem.innerHTML = `
                <div class="gm-job-header">
                    <strong>${job.name}</strong>
                    <label class="checkbox-label">
                        <input type="checkbox" data-job-key="${key}" class="gm-job-enabled" ${job.enabled ? 'checked' : ''} />
                        启用
                    </label>
                </div>
                <div class="gm-config-field">
                    <label>名称</label>
                    <input type="text" data-job-key="${key}" class="gm-job-name" value="${job.name}" />
                </div>
                <div class="gm-config-field">
                    <label>构建 URL</label>
                    <input type="text" data-job-key="${key}" class="gm-job-url" value="${job.url}" />
                </div>
            `;
            jobList.appendChild(jobItem);
        }

        overlay.style.display = 'flex';
    }

    function closeConfig() {
        const overlay = document.getElementById('gm-config-overlay');
        if (overlay) overlay.style.display = 'none';
    }

    function saveConfigFromUI() {
        // 读取并验证基础配置
        const maxRetries = parseInt(document.getElementById('gm-cfg-maxRetries').value);
        const retryDelay = parseInt(document.getElementById('gm-cfg-retryDelay').value);

        // 验证输入
        if (isNaN(maxRetries) || maxRetries < 1 || maxRetries > 10) {
            alert('❌ 验证失败：最大重试次数必须在 1-10 之间');
            return;
        }
        if (isNaN(retryDelay) || retryDelay < 1000 || retryDelay > 10000) {
            alert('❌ 验证失败：重试延迟必须在 1000-10000 毫秒之间');
            return;
        }

        CONFIG.triggerMaxRetries = maxRetries;
        CONFIG.triggerRetryDelay = retryDelay;

        // 读取 Job 配置
        const enabledInputs = document.querySelectorAll('.gm-job-enabled');
        const nameInputs = document.querySelectorAll('.gm-job-name');
        const urlInputs = document.querySelectorAll('.gm-job-url');

        let hasError = false;

        enabledInputs.forEach(input => {
            const key = input.getAttribute('data-job-key');
            CONFIG.jobs[key].enabled = input.checked;
        });

        nameInputs.forEach(input => {
            const key = input.getAttribute('data-job-key');
            const name = input.value.trim();
            if (!name) {
                alert(`❌ 验证失败：Job "${key}" 的名称不能为空`);
                hasError = true;
                return;
            }
            CONFIG.jobs[key].name = name;
        });

        if (hasError) return;

        urlInputs.forEach(input => {
            const key = input.getAttribute('data-job-key');
            const url = input.value.trim();
            if (!url) {
                alert(`❌ 验证失败：Job "${key}" 的 URL 不能为空`);
                hasError = true;
                return;
            }
            // 简单的 URL 验证
            if (!url.startsWith('http://') && !url.startsWith('https://')) {
                alert(`❌ 验证失败：Job "${key}" 的 URL 必须以 http:// 或 https:// 开头`);
                hasError = true;
                return;
            }
            CONFIG.jobs[key].url = url;
        });

        if (hasError) return;

        // 保存配置
        if (saveConfig()) {
            alert('✅ 配置保存成功！');
            closeConfig();
        } else {
            alert('❌ 配置保存失败，请检查控制台日志。可能原因：\n- 浏览器存储已满\n- Tampermonkey 权限不足\n- 存储服务异常');
        }
    }

    function resetConfigUI() {
        if (confirm('确定要恢复默认配置吗？')) {
            if (resetConfig()) {
                alert('已恢复默认配置！');
                openConfig(); // 重新打开以显示默认值
            } else {
                alert('恢复默认配置失败，请检查控制台日志。');
            }
        }
    }

    function registerConfigMenu() {
        if (typeof GM_registerMenuCommand !== 'undefined') {
            GM_registerMenuCommand('⚙️ Jenkins 构建配置', openConfig);
        }
    }

    // --- 4. 辅助函数 ---

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function addStyles() {
        const style = document.createElement('style');
        style.textContent = `
            @keyframes gm-progress-bar-stripes {
                from { background-position: 40px 0; }
                to { background-position: 0 0; }
            }
            #gm-build-panel { margin-top: 1em; }
            #gm-build-panel-title {
                display: block; font-size: 1.17em; font-weight: bold;
                color: #000; margin-bottom: 0.5em; padding-left: 5px;
            }
            #gm-build-panel .gm-button {
                width: 100%; box-sizing: border-box; padding: 8px 12px;
                font-size: 13px; border: none; border-radius: 4px;
                cursor: pointer; box-shadow: 0 2px 5px rgba(0,0,0,0.2);
            }
            #gm-build-panel .gm-button:disabled { background-color: #aaa; cursor: not-allowed; }
            #gm-build-panel #gm-start-btn { background-color: #f0ad4e; color: white; }
            #gm-build-panel #gm-start-btn:hover:not(:disabled) { background-color: #ec971f; }
            #gm-build-panel #gm-cancel-btn { background-color: #d9534f; color: white; }
            #gm-build-panel #gm-cancel-btn:hover:not(:disabled) { background-color: #c9302c; }
            #gm-step-container {
                width: 100%; background: #fff; border: 1px solid #ccc;
                border-radius: 4px; margin-top: 8px; max-height: 250px;
                overflow-y: auto; font-size: 12px; box-sizing: border-box;
                display: none;
            }
            .gm-step-strong {
                min-width: 90px; display: inline-block; margin-right: 5px;
            }
            .gm-step-status { color: #555; }

            /* 配置面板样式 */
            #gm-config-overlay {
                position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                background: rgba(0,0,0,0.5); z-index: 10000; display: none;
                justify-content: center; align-items: center;
            }
            #gm-config-modal {
                background: white; border-radius: 8px; width: 90%; max-width: 800px;
                max-height: 90vh; overflow-y: auto; box-shadow: 0 4px 20px rgba(0,0,0,0.3);
            }
            #gm-config-header {
                background: #f8f9fa; padding: 15px 20px; border-bottom: 1px solid #dee2e6;
                display: flex; justify-content: space-between; align-items: center;
                border-radius: 8px 8px 0 0;
            }
            #gm-config-header h2 { margin: 0; font-size: 18px; }
            #gm-config-close {
                background: none; border: none; font-size: 24px;
                cursor: pointer; color: #6c757d; padding: 0; width: 30px; height: 30px;
            }
            #gm-config-close:hover { color: #000; }
            #gm-config-body { padding: 20px; }
            .gm-config-section { margin-bottom: 25px; }
            .gm-config-section h3 {
                font-size: 16px; margin: 0 0 15px 0; color: #495057;
                border-bottom: 2px solid #007bff; padding-bottom: 5px;
            }
            .gm-config-field { margin-bottom: 15px; }
            .gm-config-field label {
                display: block; margin-bottom: 5px; font-weight: 500;
                font-size: 13px; color: #495057;
            }
            .gm-config-field input[type="text"],
            .gm-config-field input[type="number"] {
                width: 100%; padding: 8px 12px; border: 1px solid #ced4da;
                border-radius: 4px; font-size: 13px; box-sizing: border-box;
            }
            .gm-config-field input[type="checkbox"] {
                width: 18px; height: 18px; cursor: pointer; margin-right: 8px;
                vertical-align: middle;
            }
            .gm-config-field .checkbox-label {
                display: inline; font-weight: normal; cursor: pointer;
                vertical-align: middle;
            }
            .gm-job-item {
                background: #f8f9fa; padding: 15px; border-radius: 4px;
                margin-bottom: 10px; border: 1px solid #dee2e6;
            }
            .gm-job-header {
                display: flex; justify-content: space-between; align-items: center;
                margin-bottom: 10px;
            }
            .gm-job-header strong { font-size: 14px; }
            #gm-config-footer {
                background: #f8f9fa; padding: 15px 20px; border-top: 1px solid #dee2e6;
                display: flex; justify-content: flex-end; gap: 10px;
                border-radius: 0 0 8px 8px;
            }
            #gm-config-footer button {
                padding: 8px 20px; border: none; border-radius: 4px;
                cursor: pointer; font-size: 13px; font-weight: 500;
            }
            #gm-config-save {
                background: #28a745; color: white;
            }
            #gm-config-save:hover { background: #218838; }
            #gm-config-reset {
                background: #ffc107; color: #212529;
            }
            #gm-config-reset:hover { background: #e0a800; }
            #gm-config-cancel {
                background: #6c757d; color: white;
            }
            #gm-config-cancel:hover { background: #5a6268; }
        `;
        document.head.appendChild(style);
    }

    function getMyJenkinsCrumb() {
        const crumbInput = document.querySelector('input[name="Jenkins-Crumb"]');
        if (crumbInput) {
            return crumbInput.value;
        }
        console.error("未能找到 Jenkins Crumb input 元素。");
        return null;
    }

    // --- 3. UI 更新函数 ---

    function updateStatus(message, isError = false) {
        if (!panelTitle) return;
        console.log(message);
        panelTitle.innerText = message;
        panelTitle.style.color = isError ? 'red' : 'black';
    }

    function updateStepStatus(jobKey, message, icon, color = 'info') {
        const el = document.getElementById(`gm-step-${jobKey}`);
        if (!el) return;
        const iconEl = el.querySelector('.gm-step-icon');
        const statusEl = el.querySelector('.gm-step-status');
        if (icon) iconEl.innerText = icon;
        if (message) statusEl.innerText = message;
        switch (color) {
            case 'success': el.style.backgroundColor = '#dff0d8'; break;
            case 'warning': el.style.backgroundColor = '#fcf8e3'; break;
            case 'error': el.style.backgroundColor = '#f2dede'; break;
            case 'skipped': el.style.backgroundColor = '#f5f5f5'; break;
            case 'info': default: el.style.backgroundColor = '#fff'; break;
        }
    }

    function populateStepUI() {
        if (!stepContainer) return;
        stepContainer.innerHTML = '';
        stepContainer.style.display = 'block';
        for (const [key, jobData] of Object.entries(JOB_DEFINITIONS)) {
            const el = document.createElement('div');
            el.id = `gm-step-${key}`;
            el.style = 'padding: 5px 8px; border-bottom: 1px solid #eee;';
            el.innerHTML = `
                <span class="gm-step-icon">⚪</span>
                <strong class="gm-step-strong">${jobData.name}</strong>
                <span class="gm-step-status">未开始</span>
            `;
            stepContainer.appendChild(el);
        }
    }

    function skipPendingSteps() {
        for (const key of Object.keys(JOB_DEFINITIONS)) {
            const el = document.getElementById(`gm-step-${key}`);
            if (el && el.querySelector('.gm-step-status').innerText === '未开始') {
                updateStepStatus(key, '已跳过', '⏩', 'skipped');
            }
        }
    }

    function setProgressActive(show, text) {
        if (progressContainer) {
            progressContainer.style.display = show ? 'block' : 'none';
        }
        if (show && text) {
            updateStatus(text);
        }
    }

    function setBuildInProgressUI(inProgress) {
        if (!combinedButton || !cancelButton || !stepContainer) return;
        if (inProgress) {
            combinedButton.disabled = true;
            combinedButton.innerText = '▶ 正在构建...';
            combinedButton.style.display = 'none';
            cancelButton.style.display = 'block';
            populateStepUI();
        } else {
            combinedButton.disabled = false;
            combinedButton.innerText = '▶ 启动联合构建';
            combinedButton.style.display = 'block';
            cancelButton.style.display = 'none';
            setProgressActive(false);
        }
    }


    // --- 4. Jenkins API 核心函数 ---

    async function triggerSingleBuild(jobKey, crumb) {
        const jobData = JOB_DEFINITIONS[jobKey];
        if (!jobData) throw new BuildChainError(`Job key "${jobKey}" 未在 JOB_DEFINITIONS 中定义。`);

        updateStepStatus(jobKey, '正在请求...', '⏳', 'warning');

        for (let attempt = 0; attempt < TRIGGER_MAX_RETRIES; attempt++) {
            if (isBuildCancelled) throw new BuildChainError('构建已取消');
            try {
                const response = await fetch(jobData.url, {
                    method: 'POST',
                    headers: { 'Jenkins-Crumb': crumb },
                    body: null
                });

                if (response.status === 201) {
                    const queueUrl = response.headers.get('Location');
                    if (!queueUrl) {
                        updateStepStatus(jobKey, '触发成功，但未找到 Queue URL！', '❌', 'error');
                        throw new BuildChainError(`[${jobData.name}] 未找到 Queue URL`);
                    }
                    let successMsg = '已进入队列';
                    if (attempt > 0) successMsg = `重试成功 (第 ${attempt + 1} 次)，已入队`;
                    updateStepStatus(jobKey, successMsg, '⏳', 'warning');
                    return queueUrl;
                }

                if (response.status >= 400 && response.status < 500) {
                    updateStepStatus(jobKey, `请求失败 (状态: ${response.status})`, '❌', 'error');
                    throw new BuildChainError(`[${jobData.name}] 构建请求失败 (状态: ${response.status})`);
                }

                throw new Error(`服务器状态: ${response.status}`);

            } catch (error) {
                console.warn(`[${jobData.name}] 触发失败 (第 ${attempt + 1} 次): ${error.message}`);
                if (attempt < TRIGGER_MAX_RETRIES - 1) {
                    const retryMsg = `触发失败 (第 ${attempt + 1} 次)，${TRIGGER_RETRY_DELAY / 1000}s 后重试...`;
                    updateStepStatus(jobKey, retryMsg, '⏳', 'warning');
                    await sleep(TRIGGER_RETRY_DELAY);
                } else {
                    updateStepStatus(jobKey, `请求失败: ${error.message}`, '❌', 'error');
                    throw new BuildChainError(`[${jobData.name}] 触发失败`);
                }
            }
        }
        throw new BuildChainError(`[${jobData.name}] 未知的触发错误`);
    }

    async function getBuildNumberFromQueue(jobKey, queueUrl, crumb) {
        const jobData = JOB_DEFINITIONS[jobKey];
        if (!queueUrl) throw new BuildChainError(`[${jobData.name}] 队列 URL 为空`);
        updateStepStatus(jobKey, '等待构建编号...', '⏳', 'warning');
        const pollInterval = 2000;
        let attempts = 0;
        const maxAttempts = 30;
        while (attempts < maxAttempts) {
            if (isBuildCancelled) throw new BuildChainError('构建已取消');
            try {
                const response = await fetch(`${queueUrl}api/json`, { headers: { 'Jenkins-Crumb': crumb } });
                if (!response.ok) throw new Error(`Queue API 状态: ${response.status}`);
                const data = await response.json();
                if (data.cancelled) {
                    updateStepStatus(jobKey, '任务被取消', '❌', 'error');
                    throw new BuildChainError(`[${jobData.name}] 队列任务被取消`);
                }
                if (data.executable) {
                    const buildNumber = data.executable.number;
                    const buildUrl = data.executable.url;
                    updateStepStatus(jobKey, `已获取: #${buildNumber}`, '⏳', 'warning');
                    return { number: buildNumber, url: buildUrl };
                }
                await sleep(pollInterval);
                attempts++;
            } catch (error) {
                updateStepStatus(jobKey, `轮询队列失败`, '❌', 'error');
                throw error;
            }
        }
        updateStepStatus(jobKey, `等待构建编号超时`, '❌', 'error');
        throw new BuildChainError(`[${jobData.name}] 等待构建编号超时`);
    }

    async function pollBuildStatus(jobKey, buildInfo, crumb) {
        const jobData = JOB_DEFINITIONS[jobKey];
        if (!buildInfo || !buildInfo.url) {
            updateStepStatus(jobKey, '缺少 Build 信息', '❌', 'error');
            throw new BuildChainError(`[${jobData.name}] 无法轮询`);
        }
        const buildUrl = buildInfo.url.endsWith('/') ? buildInfo.url : buildInfo.url + '/';
        const buildNumber = buildInfo.number;
        const pollInterval = 5000;
        let isBuilding = true;
        updateStepStatus(jobKey, `正在构建 #${buildNumber}`, '⏳', 'warning');
        setProgressActive(true, `正在构建 ${jobData.name} #${buildNumber}...`);
        while (isBuilding) {
            if (isBuildCancelled) throw new BuildChainError('构建已取消');
            await sleep(pollInterval);
            try {
                const response = await fetch(`${buildUrl}api/json`, { headers: { 'Jenkins-Crumb': crumb } });
                if (!response.ok) {
                    if (response.status === 404) continue;
                    throw new Error(`Build API 状态: ${response.status}`);
                }
                const data = await response.json();
                if (data.building === false) {
                    isBuilding = false;
                    const result = data.result;
                    if (result === 'SUCCESS') {
                        updateStepStatus(jobKey, `构建成功 (#${buildNumber})`, '✅', 'success');
                    } else {
                        updateStepStatus(jobKey, `构建 ${result} (#${buildNumber})`, '❌', 'error');
                        throw new BuildChainError(`[${jobData.name}] 构建失败`);
                    }
                    return result;
                }
            } catch (error) {
                updateStepStatus(jobKey, `轮询状态失败`, '❌', 'error');
                throw error;
            }
        }
    }


    /**
     * 启动联合构建链 (核心逻辑)
     */
    async function startCombinedChain() {
        isBuildCancelled = false;
        const crumb = getMyJenkinsCrumb();
        if (!crumb) {
            updateStatus("错误：无法获取 Crumb。", true);
            return;
        }

        setBuildInProgressUI(true);
        updateStatus('联合构建已启动...');

        const jobBuilds = {};
        let stepIndex = 0;

        try {
            // --- 循环执行流水线步骤 ---
            for (const step of PIPELINE_STEPS) {
                if (isBuildCancelled) throw new BuildChainError('构建已取消');
                stepIndex++;

                // --- 处理 Parallel Wait 类型 (包含 wait=true 和 wait=false) ---
                if (step.type === 'parallel-wait') {
                    updateStatus(`步骤 ${stepIndex}: 正在并行触发...`);

                    // 过滤掉被禁用的 jobs
                    const activeJobs = step.jobs.filter(job => {
                        const jobConfig = JOB_DEFINITIONS[job.key];
                        if (!jobConfig || !jobConfig.enabled) {
                            updateStepStatus(job.key, '已禁用 (跳过)', '⏭️', 'skipped');
                            console.log(`[${job.key}] 已被禁用，跳过构建`);
                            return false;
                        }
                        return true;
                    });

                    // 如果所有 jobs 都被禁用，跳过此步骤
                    if (activeJobs.length === 0) {
                        updateStatus(`步骤 ${stepIndex}: 所有 Job 已禁用，跳过`);
                        continue;
                    }

                    // 1. 并行触发所有启用的 Job
                    const triggerPromises = activeJobs.map(job =>
                        triggerSingleBuild(job.key, crumb)
                    );
                    const queueUrls = await Promise.all(triggerPromises);

                    // 2. 区分需要等待的 Job 和不需要等待的 Job
                    const buildInfoPromises = [];
                    for (let i = 0; i < activeJobs.length; i++) {
                        const job = activeJobs[i];
                        if (job.wait) {
                            // 如果需要等待，获取 Build Number
                            buildInfoPromises.push(
                                getBuildNumberFromQueue(job.key, queueUrls[i], crumb)
                                    .then(buildInfo => {
                                        jobBuilds[job.key] = buildInfo;
                                        return buildInfo;
                                    })
                            );
                        } else {
                            // 如果不需要等待，直接标记为完成
                            updateStepStatus(job.key, '已触发 (不等待)', '▶️', 'success');
                        }
                    }

                    // 等待所有需要获取 Build Number 的请求完成
                    await Promise.all(buildInfoPromises);

                    // 3. 并行轮询状态 (只轮询 wait=true 的)
                    const pollPromises = [];
                    for (const job of activeJobs) {
                        if (job.wait) {
                            pollPromises.push(
                                pollBuildStatus(job.key, jobBuilds[job.key], crumb)
                            );
                        }
                    }
                    await Promise.all(pollPromises);

                    updateStatus(`步骤 ${stepIndex}: 本阶段构建完成！`);
                }

                // --- 处理 Sequential (如果以后还有需要的话，目前配置里已经没了) ---
                else if (step.type === 'sequential-trigger') {
                    updateStatus(`步骤 ${stepIndex}: 正在串行触发...`);
                    for (const job of step.jobs) {
                        if (isBuildCancelled) throw new BuildChainError('构建已取消');

                        // 检查 job 是否被禁用
                        const jobConfig = JOB_DEFINITIONS[job.key];
                        if (!jobConfig || !jobConfig.enabled) {
                            updateStepStatus(job.key, '已禁用 (跳过)', '⏭️', 'skipped');
                            console.log(`[${job.key}] 已被禁用，跳过构建`);
                            continue;
                        }

                        await triggerSingleBuild(job.key, crumb);
                        updateStepStatus(job.key, '已触发', '▶️', 'success');
                    }
                }
            }

            // --- 所有步骤成功 ---
            updateStatus('✅ 联合构建链全部完成！', false);
            setProgressActive(false);

        } catch (error) {
            // --- 捕获任何步骤中的失败 ---
            setProgressActive(false);
            if (error instanceof BuildChainError) {
                updateStatus(`❌ 构建链中止: ${error.message}`, true);
            } else {
                updateStatus(`❌ 发生意外错误: ${error.message}`, true);
                console.error(error);
            }
            skipPendingSteps();

        } finally {
            setBuildInProgressUI(false);
            if (panelTitle.style.color !== 'red') {
                setTimeout(() => {
                    if (!isBuildCancelled && combinedButton.disabled === false) {
                        updateStatus(PANEL_TITLE_DEFAULT, false);
                    }
                }, 5000);
            }
        }
    }


    // --- 6. UI 创建与初始化 ---

    function createUI() {
        const sidePanel = document.getElementById('side-panel');
        if (!sidePanel) return;

        addStyles();

        // 初始化配置 UI 和菜单（配置已在脚本开始时预加载）
        createConfigUI();
        registerConfigMenu();

        const mainPanel = document.createElement('div');
        mainPanel.id = 'gm-build-panel';
        mainPanel.className = 'task';

        panelTitle = document.createElement('div');
        panelTitle.id = 'gm-build-panel-title';
        panelTitle.innerText = PANEL_TITLE_DEFAULT;

        const controlsContainer = document.createElement('div');
        controlsContainer.style = 'padding: 0 5px;';

        combinedButton = document.createElement('button');
        combinedButton.id = 'gm-start-btn';
        combinedButton.className = 'gm-button';
        combinedButton.innerText = '▶ 启动联合构建';
        combinedButton.onclick = startCombinedChain;

        cancelButton = document.createElement('button');
        cancelButton.id = 'gm-cancel-btn';
        cancelButton.className = 'gm-button';
        cancelButton.innerText = '■ 取消';
        cancelButton.style.display = 'none';
        cancelButton.onclick = function() {
            isBuildCancelled = true;
            updateStatus('正在取消，请稍候...', true);
        };

        progressContainer = document.createElement('div');
        progressContainer.id = 'gm-progress-container';
        progressContainer.style = `
            width: 100%; height: 10px; background-color: #e9ecef;
            border: 1px solid #ced4da; border-radius: 4px;
            box-sizing: border-box; display: none; overflow: hidden;
            margin: 8px 0;
        `;
        progressBar = document.createElement('div');
        progressBar.id = 'gm-progress-bar';
        progressBar.style = `
            height: 100%; width: 100%; background-color: #007bff;
            border-radius: 2px;
            background-size: 40px 40px;
            background-image: linear-gradient(45deg, rgba(255, 255, 255, .15) 25%, transparent 25%, transparent 50%, rgba(255, 255, 255, .15) 50%, rgba(255, 255, 255, .15) 75%, transparent 75%, transparent);
            animation: gm-progress-bar-stripes 1s linear infinite;
        `;
        progressContainer.appendChild(progressBar);

        stepContainer = document.createElement('div');
        stepContainer.id = 'gm-step-container';

        controlsContainer.appendChild(combinedButton);
        controlsContainer.appendChild(cancelButton);
        mainPanel.appendChild(panelTitle);
        mainPanel.appendChild(controlsContainer);
        mainPanel.appendChild(progressContainer);
        mainPanel.appendChild(stepContainer);
        sidePanel.appendChild(mainPanel);

        const oldUpdateStatus = updateStatus;
        updateStatus = (message, isError = false) => {
            if (panelTitle) oldUpdateStatus(message, isError);
        };

        console.log('Jenkins 联合构建 (v7.3 - 全并行模式) 已加载。');
    }

    if (document.body) createUI();
    else window.addEventListener('load', createUI);

})();