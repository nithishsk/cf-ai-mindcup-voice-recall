const { createApp, ref, computed, onMounted, onUnmounted } = Vue;

const MAX_NOTE_CHARS = 1000;
const MAX_AUDIO_BYTES = 1_000_000;
const MAX_RECORD_SECONDS = 60;
const POLL_INTERVAL_MS = 3000;

function getOrCreateSessionId() {
	const key = 'mindcup_session_id';
	let id = localStorage.getItem(key);
	if (!id) {
		id = crypto.randomUUID();
		localStorage.setItem(key, id);
	}
	return id;
}

createApp({
	setup() {
		const sessionId = getOrCreateSessionId();
		const noteContent = ref('');
		const activeNoteId = ref(null);

		const isRecording = ref(false);
		const remainingSeconds = ref(MAX_RECORD_SECONDS);
		const audioBlob = ref(null);
		const audioUrl = ref('');

		const isSubmitting = ref(false);
		const pollingStatus = ref('queued');
		const errorMessage = ref('');

		const currentReview = ref(null);
		const hoveredSegment = ref(null);
		const selectedSegment = ref(null);

		const sessionNotes = ref([]);
		const sessionReviews = ref([]);
		const selectedHistoryNoteId = ref(null);

		let mediaRecorder = null;
		let audioChunks = [];
		let recordTimer = null;
		let pollTimer = null;

		const canSubmit = computed(() => {
			return (
				!isSubmitting.value &&
				!isRecording.value &&
				noteContent.value.trim().length > 0 &&
				noteContent.value.length <= MAX_NOTE_CHARS &&
				audioBlob.value !== null &&
				audioBlob.value.size <= MAX_AUDIO_BYTES
			);
		});

		const activeSegment = computed(() => selectedSegment.value || hoveredSegment.value);

		const highlightedChunks = computed(() => {
			const review = currentReview.value;
			if (!review || !review.result || !review.noteSnapshot) return [];

			const text = review.noteSnapshot;
			const segments = review.result.segments || [];
			const matches = [];

			for (const seg of segments) {
				if (!seg.noteQuote) continue;
				const idx = text.toLowerCase().indexOf(seg.noteQuote.toLowerCase());
				if (idx !== -1) {
					matches.push({ start: idx, end: idx + seg.noteQuote.length, segment: seg });
				}
			}

			matches.sort((a, b) => a.start - b.start);

			const chunks = [];
			let cursor = 0;
			for (const m of matches) {
				if (m.start < cursor) continue;
				if (m.start > cursor) {
					chunks.push({ text: text.slice(cursor, m.start), segment: null });
				}
				chunks.push({ text: text.slice(m.start, m.end), segment: m.segment });
				cursor = m.end;
			}
			if (cursor < text.length) {
				chunks.push({ text: text.slice(cursor), segment: null });
			}
			return chunks;
		});

		const uniqueNotes = computed(() => {
			const map = new Map();
			for (const rev of sessionReviews.value) {
				const existing = map.get(rev.noteId);
				if (!existing) {
					const noteObj = sessionNotes.value.find((n) => n.noteId === rev.noteId);
					map.set(rev.noteId, {
						noteId: rev.noteId,
						content: noteObj ? noteObj.content : rev.noteSnapshot,
						attempts: 1,
						latestScore: rev.score,
						latestAt: rev.createdAt,
					});
				} else {
					existing.attempts += 1;
					if (rev.createdAt > existing.latestAt) {
						existing.latestAt = rev.createdAt;
						existing.latestScore = rev.score;
					}
				}
			}
			return Array.from(map.values()).sort((a, b) => b.latestAt - a.latestAt);
		});

		const selectedNoteReviews = computed(() => {
			if (!selectedHistoryNoteId.value) return [];
			return sessionReviews.value.filter((r) => r.noteId === selectedHistoryNoteId.value);
		});

		async function apiFetch(url, options = {}) {
			const headers = new Headers(options.headers || {});
			headers.set('X-Session-Id', sessionId);
			const res = await fetch(url, { ...options, headers });
			if (res.status === 429) {
				throw new Error('Rate limit exceeded. Please wait a moment and try again.');
			}
			return res;
		}

		async function fetchSession() {
			try {
				const res = await apiFetch('/api/session');
				if (!res.ok) return;
				const data = await res.json();
				sessionNotes.value = data.notes || [];
				sessionReviews.value = data.reviews || [];
			} catch (err) {
				errorMessage.value = err.message || 'Failed to load session history';
			}
		}

		async function startRecording() {
			errorMessage.value = '';
			try {
				const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
				const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
				mediaRecorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 24000 });
				audioChunks = [];

				mediaRecorder.ondataavailable = (e) => {
					if (e.data.size > 0) audioChunks.push(e.data);
				};

				mediaRecorder.onstop = () => {
					stream.getTracks().forEach((t) => t.stop());
					const blob = new Blob(audioChunks, { type: mimeType });
					if (blob.size > MAX_AUDIO_BYTES) {
						errorMessage.value = 'Recorded audio exceeds 1 MB limit.';
						return;
					}
					setAudioBlob(blob);
				};

				mediaRecorder.start();
				isRecording.value = true;
				remainingSeconds.value = MAX_RECORD_SECONDS;

				recordTimer = setInterval(() => {
					remainingSeconds.value -= 1;
					if (remainingSeconds.value <= 0) {
						stopRecording();
					}
				}, 1000);
			} catch {
				errorMessage.value = 'Microphone access denied or unavailable.';
			}
		}

		function stopRecording() {
			if (recordTimer) {
				clearInterval(recordTimer);
				recordTimer = null;
			}
			if (mediaRecorder && mediaRecorder.state !== 'inactive') {
				mediaRecorder.stop();
			}
			isRecording.value = false;
		}

		function clearAudio() {
			if (audioUrl.value) URL.revokeObjectURL(audioUrl.value);
			audioBlob.value = null;
			audioUrl.value = '';
		}

		function setAudioBlob(blob) {
			if (audioUrl.value) URL.revokeObjectURL(audioUrl.value);
			audioBlob.value = blob;
			audioUrl.value = URL.createObjectURL(blob);
		}

		function handleFileUpload(event) {
			errorMessage.value = '';
			const file = event.target.files?.[0];
			if (!file) return;
			if (file.size > MAX_AUDIO_BYTES) {
				errorMessage.value = 'Audio file must be less than 1 MB.';
				return;
			}
			setAudioBlob(file);
		}

		async function loadSampleDemo() {
			errorMessage.value = '';
			try {
				const noteRes = await fetch('/samples/upsc-note.txt');
				if (noteRes.ok) {
					noteContent.value = (await noteRes.text()).trim().slice(0, MAX_NOTE_CHARS);
					activeNoteId.value = null;
				}
				const audioRes = await fetch('/samples/upsc-audio.wav');
				if (audioRes.ok) {
					const blob = await audioRes.blob();
					if (blob.size <= MAX_AUDIO_BYTES) {
						setAudioBlob(blob);
					} else {
						errorMessage.value = `Sample audio (${formatBytes(blob.size)}) exceeds the 1 MB limit.`;
					}
				} else {
					errorMessage.value = 'Loaded UPSC note. Place your sample audio at public/samples/upsc-audio.wav or record your own.';
				}
			} catch {
				errorMessage.value = 'Failed to load sample demo.';
			}
		}

		async function submitReview() {
			if (!canSubmit.value) return;
			errorMessage.value = '';
			isSubmitting.value = true;
			pollingStatus.value = 'queued';
			currentReview.value = null;
			selectedSegment.value = null;
			hoveredSegment.value = null;

			try {
				const formData = new FormData();
				formData.append('noteContent', noteContent.value.trim());
				formData.append('audio', audioBlob.value, 'recording.webm');
				if (activeNoteId.value) {
					formData.append('noteId', activeNoteId.value);
				}

				const res = await apiFetch('/api/review', { method: 'POST', body: formData });
				const data = await res.json();
				if (!res.ok) {
					throw new Error(data.error || 'Failed to submit review');
				}

				clearAudio();
				pollReview(data.reviewId);
			} catch (err) {
				errorMessage.value = err.message;
				isSubmitting.value = false;
			}
		}

		function pollReview(reviewId) {
			if (pollTimer) clearInterval(pollTimer);
			pollTimer = setInterval(async () => {
				try {
					const res = await apiFetch(`/api/review/${reviewId}`);
					if (!res.ok) return;
					const { review } = await res.json();
					pollingStatus.value = review.status;

					if (review.status === 'completed') {
						clearInterval(pollTimer);
						pollTimer = null;
						isSubmitting.value = false;
						currentReview.value = review;
						await fetchSession();
					} else if (review.status === 'failed') {
						clearInterval(pollTimer);
						pollTimer = null;
						isSubmitting.value = false;
						errorMessage.value = review.errorMessage || 'Review processing failed.';
					}
				} catch (err) {
					clearInterval(pollTimer);
					pollTimer = null;
					isSubmitting.value = false;
					errorMessage.value = err.message;
				}
			}, POLL_INTERVAL_MS);
		}

		function selectHistoryNote(noteId) {
			selectedHistoryNoteId.value = noteId;
			currentReview.value = null;
			selectedSegment.value = null;
			hoveredSegment.value = null;
		}

		function rereviewNote(noteId) {
			const note = uniqueNotes.value.find((n) => n.noteId === noteId);
			if (!note) return;
			noteContent.value = note.content;
			activeNoteId.value = noteId;
			currentReview.value = null;
			selectedSegment.value = null;
			hoveredSegment.value = null;
			window.scrollTo({ top: 0, behavior: 'smooth' });
		}

		function clearActiveNote() {
			activeNoteId.value = null;
			noteContent.value = '';
			currentReview.value = null;
			selectedSegment.value = null;
			hoveredSegment.value = null;
		}

		function viewReview(review) {
			currentReview.value = review;
			selectedSegment.value = null;
			hoveredSegment.value = null;
		}

		function segmentClass(status) {
			if (status === 'correct') return 'bg-emerald-100 border-emerald-400 hover:bg-emerald-200';
			if (status === 'wrong') return 'bg-rose-100 border-rose-400 hover:bg-rose-200';
			return 'bg-amber-100 border-amber-400 hover:bg-amber-200';
		}

		function detailCardClass(status) {
			if (status === 'correct') return 'bg-emerald-50 border-emerald-200 text-emerald-900';
			if (status === 'wrong') return 'bg-rose-50 border-rose-200 text-rose-900';
			return 'bg-amber-50 border-amber-200 text-amber-900';
		}

		function formatBytes(bytes) {
			if (!bytes) return '0 B';
			return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
		}

		function formatDate(ts) {
			return new Date(ts).toLocaleString();
		}

		onMounted(fetchSession);
		onUnmounted(() => {
			if (recordTimer) clearInterval(recordTimer);
			if (pollTimer) clearInterval(pollTimer);
			if (audioUrl.value) URL.revokeObjectURL(audioUrl.value);
		});

		return {
			noteContent,
			activeNoteId,
			isRecording,
			remainingSeconds,
			audioBlob,
			audioUrl,
			isSubmitting,
			pollingStatus,
			errorMessage,
			currentReview,
			hoveredSegment,
			selectedSegment,
			activeSegment,
			highlightedChunks,
			uniqueNotes,
			selectedHistoryNoteId,
			selectedNoteReviews,
			canSubmit,
			startRecording,
			stopRecording,
			handleFileUpload,
			loadSampleDemo,
			submitReview,
			selectHistoryNote,
			rereviewNote,
			clearActiveNote,
			viewReview,
			segmentClass,
			detailCardClass,
			formatBytes,
			formatDate,
		};
	},
}).mount('#app');
