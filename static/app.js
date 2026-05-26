document.addEventListener('DOMContentLoaded', () => {
    const uploadForm = document.getElementById('uploadForm');
    const fileInput = document.getElementById('fileInput');
    const uploadBtn = document.getElementById('uploadBtn');
    const fileList = document.getElementById('fileList');
    const chatContainer = document.getElementById('chatContainer');
    const promptInput = document.getElementById('promptInput');
    const sendBtn = document.getElementById('sendBtn');
    const clearChat = document.getElementById('clearChat');
    const testMeBtn = document.getElementById('testMeBtn');
    const quizColumn = document.getElementById('quizColumn'); 
    const chatColumn = document.getElementById('chatColumn');
    const quizContainer = document.getElementById('quizContainer');
    const quizTab = document.getElementById('quiz-tab'); // Reference to the tab button
    const videoOverlay = document.getElementById('videoOverlay');
    const floatingPlayer = document.getElementById('floatingPlayer');
    const videoTitle = document.getElementById('videoTitle');
    const closeVideo = document.getElementById('closeVideo');
    const suggestionsContainer = document.getElementById('suggestionsContainer');
    const refreshSuggestions = document.getElementById('refreshSuggestions');

    // Handle Quiz Generation
    testMeBtn.addEventListener('click', async () => {
        const selectedDocs = Array.from(document.querySelectorAll('.doc-checkbox:checked')).map(cb => parseInt(cb.value));
        if (selectedDocs.length === 0) {
            alert('Please select at least one material to generate a quiz.');
            return;
        }

        // Switch to Quiz Tab
        const bsTab = new bootstrap.Tab(quizTab);
        bsTab.show();
        
        quizContainer.innerHTML = '<div class="text-center my-3"><div class="spinner-border spinner-border-sm text-primary" role="status"></div><p class="small mt-2">Generating quiz...</p></div>';

        try {
            const response = await fetch('/api/quiz', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ document_ids: selectedDocs })
            });
            const result = await response.json();

            if (response.ok) {
                renderQuiz(result.quiz);
            } else {
                quizContainer.innerHTML = `<div class="alert alert-danger small">${result.detail}</div>`;
            }
        } catch (error) {
            console.error('Error:', error);
            quizContainer.innerHTML = '<div class="alert alert-danger small">Failed to generate quiz.</div>';
        }
    });

    // Handle Suggested Questions
    async function updateSuggestions() {
        const selectedDocs = Array.from(document.querySelectorAll('.doc-checkbox:checked')).map(cb => parseInt(cb.value));
        if (selectedDocs.length === 0) {
            suggestionsContainer.innerHTML = '<p class="text-muted small text-center my-3">Select materials to see suggestions.</p>';
            return;
        }

        suggestionsContainer.innerHTML = '<div class="text-center py-2"><div class="spinner-border spinner-border-sm text-primary" role="status"></div></div>';

        try {
            const response = await fetch('/api/suggestions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ document_ids: selectedDocs })
            });
            const result = await response.json();

            if (response.ok && result.suggestions.length > 0) {
                renderSuggestions(result.suggestions);
            } else {
                suggestionsContainer.innerHTML = '<p class="text-muted small text-center my-3">No suggestions available.</p>';
            }
        } catch (error) {
            console.error('Error:', error);
            suggestionsContainer.innerHTML = '<p class="text-danger small text-center my-3">Failed to load suggestions.</p>';
        }
    }

    function renderSuggestions(suggestions) {
        suggestionsContainer.innerHTML = '';
        suggestions.forEach(s => {
            const btn = document.createElement('button');
            btn.className = 'btn btn-outline-primary btn-sm w-100 text-start mb-2 small shadow-sm';
            btn.innerHTML = `<i class="bi bi-lightning-fill me-1 small"></i> ${s}`;
            btn.onclick = () => {
                promptInput.value = s;
                sendBtn.click();
            };
            suggestionsContainer.appendChild(btn);
        });
    }

    refreshSuggestions.addEventListener('click', updateSuggestions);

    // Listen for changes in document selection to update suggestions
    document.querySelectorAll('.doc-checkbox').forEach(cb => {
        cb.addEventListener('change', () => {
            // Only update if the quiz column is visible (or always update if we want proactive suggestions)
            updateSuggestions();
        });
    });

    // Initial check on load
    if (document.querySelectorAll('.doc-checkbox:checked').length > 0) {
        // We might want to wait a bit or let the user click refresh to save tokens
        // But the user asked for this section, so let's show it.
        // updateSuggestions(); 
    }

    function renderQuiz(questions) {
        quizContainer.innerHTML = '';
        questions.forEach((q, qIdx) => {
            const qDiv = document.createElement('div');
            qDiv.className = 'quiz-question shadow-sm';
            qDiv.innerHTML = `
                <p class="fw-bold">Q${qIdx + 1}: ${q.question}</p>
                <div class="list-group list-group-flush">
                    ${q.options.map((opt, oIdx) => `
                        <button class="list-group-item list-group-item-action quiz-option" 
                                data-q="${qIdx}" data-o="${oIdx}">
                            ${opt}
                        </button>
                    `).join('')}
                </div>
                <div class="explanation d-none mt-3 small text-muted p-2 bg-light border-start border-4 border-info">
                    <strong>Explanation:</strong> ${q.explanation}
                </div>
            `;
            quizContainer.appendChild(qDiv);
        });

        // Add Click Handlers for Options
        document.querySelectorAll('.quiz-option').forEach(btn => {
            btn.addEventListener('click', () => {
                const qIdx = btn.getAttribute('data-q');
                const oIdx = parseInt(btn.getAttribute('data-o'));
                const question = questions[qIdx];
                const options = btn.parentElement.querySelectorAll('.quiz-option');
                
                // Disable all options for this question
                options.forEach(opt => opt.disabled = true);
                
                // Show Correct/Wrong
                if (oIdx === question.correct_index) {
                    btn.classList.add('correct-answer', 'text-white');
                } else {
                    btn.classList.add('wrong-answer', 'text-white');
                    options[question.correct_index].classList.add('correct-answer');
                }
                
                // Show Explanation
                btn.closest('.quiz-question').querySelector('.explanation').classList.remove('d-none');
            });
        });
    }

    // Floating Video Player Logic
    closeVideo.addEventListener('click', () => {
        videoOverlay.classList.add('d-none');
        floatingPlayer.pause();
    });

    function parseTimestamps(content) {
        // Regex for [MM:SS] or [HH:MM:SS]
        const regex = /\[(\d{1,2}:)?(\d{1,2}):(\d{2})\]/g;
        return content.replace(regex, (match) => {
            return `<span class="timestamp-link" data-time="${match.slice(1, -1)}">${match}</span>`;
        });
    }

    function handleTimestampClick(e) {
        if (e.target.classList.contains('timestamp-link')) {
            const timeStr = e.target.getAttribute('data-time');
            const parts = timeStr.split(':').map(Number);
            let seconds = 0;
            if (parts.length === 3) {
                seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
            } else {
                seconds = parts[0] * 60 + parts[1];
            }

            // Find the first video among selected documents
            const selectedDocs = Array.from(document.querySelectorAll('.doc-checkbox:checked'));
            // In a real app, we'd match the filename, but for now we'll find the first 'video' type
            // We can fetch doc info if needed, or just assume the first selected video
            // For this prototype, we'll try to find any video file in the sidebar
            const videoDoc = selectedDocs.find(cb => {
                const badge = cb.closest('.doc-item').querySelector('.badge').textContent;
                return ['mp4', 'webm', 'ogg', 'video'].some(t => badge.toLowerCase().includes(t));
            });

            if (videoDoc) {
                const filename = videoDoc.closest('.doc-item').querySelector('label').textContent.trim();
                videoTitle.textContent = filename;
                floatingPlayer.src = `/uploads/${encodeURIComponent(filename)}`;
                videoOverlay.classList.remove('d-none');
                floatingPlayer.currentTime = seconds;
                floatingPlayer.play();
            } else {
                alert('Please select a video file in the sidebar to view this timestamp.');
            }
        }
    }

    document.addEventListener('click', handleTimestampClick);

    // Handle Sending Questions
    uploadForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const files = fileInput.files;
        if (files.length === 0) return;

        const formData = new FormData();
        for (let i = 0; i < files.length; i++) {
            formData.append('files', files[i]);
        }

        uploadBtn.disabled = true;
        uploadBtn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Uploading...';

        try {
            const response = await fetch('/api/upload', {
                method: 'POST',
                body: formData
            });
            const result = await response.json();
            
            if (response.ok) {
                location.reload(); // Refresh to show new files in sidebar
            } else {
                alert('Upload failed: ' + result.detail);
            }
        } catch (error) {
            console.error('Error:', error);
            alert('An error occurred during upload.');
        } finally {
            uploadBtn.disabled = false;
            uploadBtn.innerHTML = '<i class="bi bi-cloud-upload me-1"></i>Upload';
        }
    });

    // Handle File Deletion
    document.querySelectorAll('.delete-doc').forEach(button => {
        button.addEventListener('click', async (e) => {
            const docId = button.getAttribute('data-id');
            const docItem = button.closest('.doc-item');
            
            if (!confirm('Are you sure you want to delete this material?')) return;

            try {
                const response = await fetch(`/api/documents/${docId}`, {
                    method: 'DELETE'
                });
                
                if (response.ok) {
                    docItem.remove();
                    // If no items left, show empty state
                    if (document.querySelectorAll('.doc-item').length === 0) {
                        fileList.innerHTML = '<p class="text-muted small text-center empty-msg">No materials uploaded yet.</p>';
                    }
                } else {
                    const result = await response.json();
                    alert('Delete failed: ' + result.detail);
                }
            } catch (error) {
                console.error('Error:', error);
                alert('An error occurred during deletion.');
            }
        });
    });

    // Handle Sending Questions
    sendBtn.addEventListener('click', async () => {
        const prompt = promptInput.value.trim();
        if (!prompt) return;

        const selectedDocs = Array.from(document.querySelectorAll('.doc-checkbox:checked')).map(cb => parseInt(cb.value));
        
        // Append user message
        appendMessage('user', prompt);
        promptInput.value = '';
        
        // Append AI loading state
        const loadingDiv = document.createElement('div');
        loadingDiv.className = 'message message-ai loading-msg';
        loadingDiv.innerHTML = '<div class="spinner-border spinner-border-sm text-primary" role="status"></div> AI is thinking...';
        chatContainer.appendChild(loadingDiv);
        scrollToBottom();

        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    prompt: prompt,
                    document_ids: selectedDocs
                })
            });
            const result = await response.json();

            chatContainer.removeChild(loadingDiv);

            if (response.ok) {
                appendMessage('ai', result.answer);
            } else {
                appendMessage('ai', 'Error: ' + result.detail);
            }
        } catch (error) {
            console.error('Error:', error);
            chatContainer.removeChild(loadingDiv);
            appendMessage('ai', 'An error occurred while connecting to the AI.');
        }
    });

    // Enter to send
    promptInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendBtn.click();
        }
    });

    clearChat.addEventListener('click', () => {
        chatContainer.innerHTML = `
            <div class="text-center text-muted my-5">
                <i class="bi bi-chat-dots fs-1"></i>
                <p>Upload materials and ask a question to get started.</p>
            </div>
        `;
    });

    function appendMessage(role, content) {
        // Remove empty state if present
        const emptyState = chatContainer.querySelector('.text-center.text-muted');
        if (emptyState) emptyState.remove();

        const msgDiv = document.createElement('div');
        msgDiv.className = `message message-${role}`;
        
        if (role === 'ai') {
            msgDiv.innerHTML = parseTimestamps(marked.parse(content));
            // Add a copy button for AI messages
            const copyBtn = document.createElement('button');
            copyBtn.className = 'btn btn-sm btn-link text-decoration-none p-0 mt-2 d-block';
            copyBtn.innerHTML = '<i class="bi bi-clipboard me-1"></i>Copy notes';
            copyBtn.onclick = () => {
                navigator.clipboard.writeText(content).then(() => {
                    copyBtn.innerHTML = '<i class="bi bi-check2 me-1"></i>Copied!';
                    setTimeout(() => copyBtn.innerHTML = '<i class="bi bi-clipboard me-1"></i>Copy notes', 2000);
                });
            };
            msgDiv.appendChild(copyBtn);
        } else {
            msgDiv.textContent = content;
        }

        chatContainer.appendChild(msgDiv);
        scrollToBottom();
    }

    function scrollToBottom() {
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }
});
