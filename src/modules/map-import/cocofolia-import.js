(function () {
  const IMPORT_STATE = {
    lastValidated: null,
    isBusy: false,
  };

  function requireMapImportGM() {
    if (typeof requireGM === 'function') return requireGM('map import');
    if (!window.St?.isGM) {
      if (typeof showToast === 'function') showToast('GM만 사용할 수 있는 기능이에요.');
      return false;
    }
    return true;
  }

  function getModalElements() {
    return {
      summary: document.getElementById('map-import-summary'),
      error: document.getElementById('map-import-error'),
      hint: document.getElementById('map-import-hint'),
      fileInput: document.getElementById('map-import-file'),
    };
  }

  function resetMapImportUi() {
    const { summary, error, hint, fileInput } = getModalElements();
    if (summary) {
      summary.style.display = 'none';
      summary.innerHTML = '';
    }
    if (error) {
      error.style.display = 'none';
      error.textContent = '';
    }
    if (hint) {
      hint.style.display = '';
      hint.textContent = '지원 예정 항목: 배경 이미지, 전경 이미지, item 오브젝트. 현재는 유효성 검사까지만 활성화됩니다.';
    }
    if (fileInput) fileInput.value = '';
  }

  function openMapImportModal() {
    if (!requireMapImportGM()) return;
    resetMapImportUi();
    if (typeof openModal === 'function') openModal('modal-map-import');
  }

  function setError(message) {
    const { error, hint } = getModalElements();
    if (error) {
      error.style.display = '';
      error.textContent = message;
    }
    if (hint) hint.style.display = 'none';
  }

  function setSummary(html) {
    const { summary, hint, error } = getModalElements();
    if (summary) {
      summary.style.display = '';
      summary.innerHTML = html;
    }
    if (hint) hint.style.display = 'none';
    if (error) {
      error.style.display = 'none';
      error.textContent = '';
    }
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function ensureJsZipReady() {
    if (!window.JSZip) {
      throw new Error('ZIP 해제 라이브러리를 불러오지 못했어요. 새로고침 후 다시 시도해 주세요.');
    }
  }

  function buildValidationSummary(file, parsed) {
    const room = parsed?.entities?.room || {};
    const items = parsed?.entities?.items || {};
    const resources = parsed?.resources || {};
    const version = parsed?.meta?.version || '알 수 없음';
    const gridLabel = room.displayGrid ? '표시' : '숨김';
    return [
      `<b>검사 완료</b>`,
      `파일명: ${escapeHtml(file.name)}`,
      `버전: ${escapeHtml(version)}`,
      `배경 이미지: ${room.backgroundUrl ? '있음' : '없음'}`,
      `전경 이미지: ${room.foregroundUrl ? '있음' : '없음'}`,
      `item 수: ${Object.keys(items).length}개`,
      `리소스 수: ${Object.keys(resources).length}개`,
      `그리드: ${gridLabel} / 크기 ${Number(room.gridSize || 0) || 0}`,
      `다음 단계에서 실제 맵 적용 기능을 연결할 수 있는 상태입니다.`,
    ].join('<br>');
  }

  function validateParsedCocofoliaData(data) {
    if (!data || typeof data !== 'object') throw new Error('__data.json 형식이 올바르지 않아요.');
    if (!data.meta || typeof data.meta !== 'object') throw new Error('meta 정보가 없어요.');
    if (!data.entities || typeof data.entities !== 'object') throw new Error('entities 정보가 없어요.');
    if (!data.resources || typeof data.resources !== 'object') throw new Error('resources 정보가 없어요.');
    if (!data.entities.room || typeof data.entities.room !== 'object') throw new Error('room 정보가 없어요.');
    if (!data.entities.items || typeof data.entities.items !== 'object') throw new Error('items 정보가 없어요.');
    return true;
  }

  async function parseCocofoliaZip(file) {
    ensureJsZipReady();
    const zip = await window.JSZip.loadAsync(file);
    const dataEntry = zip.file('__data.json');
    if (!dataEntry) throw new Error('코코포리아 ZIP이 아니에요. __data.json 파일이 없습니다.');
    const jsonText = await dataEntry.async('string');
    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch (err) {
      throw new Error('__data.json을 읽었지만 JSON 파싱에 실패했어요.');
    }
    validateParsedCocofoliaData(parsed);
    return parsed;
  }

  async function handleMapImportFile(input) {
    if (!requireMapImportGM()) {
      if (input) input.value = '';
      return;
    }
    const file = input?.files?.[0];
    if (!file) return;
    if (IMPORT_STATE.isBusy) return;
    IMPORT_STATE.isBusy = true;
    const { hint } = getModalElements();
    try {
      if (!/\.zip$/i.test(file.name)) throw new Error('ZIP 파일만 업로드할 수 있어요.');
      if (hint) {
        hint.style.display = '';
        hint.textContent = '맵세팅 ZIP을 검사하는 중이에요…';
      }
      const parsed = await parseCocofoliaZip(file);
      IMPORT_STATE.lastValidated = { fileName: file.name, parsed };
      setSummary(buildValidationSummary(file, parsed));
      if (typeof showToast === 'function') showToast('맵세팅 ZIP 검사 완료');
    } catch (err) {
      console.error('map import validation failed', err);
      IMPORT_STATE.lastValidated = null;
      setError(err?.message || '맵세팅 ZIP 검사 중 오류가 발생했어요.');
    } finally {
      IMPORT_STATE.isBusy = false;
      if (input) input.value = '';
    }
  }

  window.openMapImportModal = openMapImportModal;
  window.handleMapImportFile = handleMapImportFile;
})();
