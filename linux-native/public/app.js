const state = {
  token: sessionStorage.getItem('mbl-token') ?? '',
  profiles: [],
  viewerProfileId: null,
  socket: null,
  frameUrl: null,
};

const elements = {
  token: document.getElementById('token'),
  saveToken: document.getElementById('save-token'),
  authState: document.getElementById('auth-state'),
  createForm: document.getElementById('create-profile'),
  profileName: document.getElementById('profile-name'),
  proxyHost: document.getElementById('proxy-host'),
  proxyPort: document.getElementById('proxy-port'),
  proxyType: document.getElementById('proxy-type'),
  status: document.getElementById('status'),
  rows: document.getElementById('profile-rows'),
  viewerProfile: document.getElementById('viewer-profile'),
  viewerUrl: document.getElementById('viewer-url'),
  viewerNavigate: document.getElementById('viewer-navigate'),
  viewerRefresh: document.getElementById('viewer-refresh'),
  viewerImage: document.getElementById('viewer-image'),
  viewerEmpty: document.getElementById('viewer-empty'),
  viewerStatus: document.getElementById('viewer-status'),
};

function setStatus(message, isError = false) {
  elements.status.textContent = message;
  elements.status.classList.toggle('error', isError);
}

function setViewerStatus(message, isError = false) {
  elements.viewerStatus.textContent = message;
  elements.viewerStatus.classList.toggle('error', isError);
}

function authHeaders() {
  return state.token ? { Authorization: `Bearer ${state.token}` } : {};
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...authHeaders(),
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  let payload = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { error: `Respuesta no válida del servidor (HTTP ${response.status})` };
    }
  }
  if (!response.ok) {
    throw new Error(payload.error ?? `HTTP ${response.status}`);
  }
  return payload;
}

function updateAuthState(authenticated) {
  elements.authState.textContent = authenticated ? 'autenticado' : 'sin autenticar';
  elements.authState.classList.toggle('badge-on', authenticated);
  elements.authState.classList.toggle('badge-off', !authenticated);
}

async function refreshProfiles() {
  try {
    const { profiles } = await api('/api/profiles');
    state.profiles = profiles;
    updateAuthState(true);
    renderProfiles();
  } catch (error) {
    updateAuthState(false);
    setStatus(error.message, true);
  }
}

function renderProfiles() {
  elements.rows.replaceChildren();
  for (const profile of state.profiles) {
    const row = document.createElement('tr');

    const name = document.createElement('td');
    name.textContent = profile.name;

    const status = document.createElement('td');
    status.textContent = profile.status;
    if (profile.status === 'running') status.classList.add('badge-on');

    const proxy = document.createElement('td');
    proxy.textContent = profile.proxy ?? '—';

    const actions = document.createElement('td');
    actions.className = 'actions';

    if (profile.status === 'running') {
      actions.append(
        button('Cerrar', 'secondary', async () => {
          await api(`/api/profiles/${profile.id}/close`, { method: 'POST' });
          await refreshProfiles();
        }),
      );
    } else {
      actions.append(
        button('Abrir', '', async () => {
          try {
            await api(`/api/profiles/${profile.id}/open`, { method: 'POST' });
            await refreshProfiles();
          } catch (error) {
            setStatus(error.message, true);
          }
        }),
      );
    }

    actions.append(
      button('Ver', 'secondary', () => selectViewerProfile(profile.id)),
      button('Exportar', 'secondary', async () => {
        const bundle = await api(`/api/profiles/${profile.id}/export`);
        const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${profile.name}.mbl.json`;
        link.click();
        URL.revokeObjectURL(url);
      }),
      button('Eliminar', 'secondary', async () => {
        if (!confirm(`¿Eliminar el perfil "${profile.name}"?`)) return;
        await api(`/api/profiles/${profile.id}`, { method: 'DELETE' });
        await refreshProfiles();
      }),
    );

    row.append(name, status, proxy, actions);
    elements.rows.append(row);
  }

  const running = state.profiles.filter((profile) => profile.status === 'running');
  elements.viewerProfile.replaceChildren();
  for (const profile of running) {
    const option = document.createElement('option');
    option.value = profile.id;
    option.textContent = profile.name;
    elements.viewerProfile.append(option);
  }
  if (state.viewerProfileId && running.some((p) => p.id === state.viewerProfileId)) {
    elements.viewerProfile.value = state.viewerProfileId;
  } else if (running.length > 0 && !state.viewerProfileId) {
    elements.viewerProfile.value = running[0].id;
  }
}

function button(label, className, onClick) {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = label;
  if (className) element.className = className;
  element.addEventListener('click', async () => {
    try {
      await onClick();
    } catch (error) {
      setStatus(error.message, true);
    }
  });
  return element;
}

function selectViewerProfile(profileId) {
  state.viewerProfileId = profileId;
  elements.viewerProfile.value = profileId;
  connectViewer(profileId);
}

function connectViewer(profileId) {
  if (state.socket) {
    state.socket.close();
    state.socket = null;
  }
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  const url = `${scheme}://${location.host}/api/profiles/${encodeURIComponent(profileId)}/viewer`;
  const socket = new WebSocket(url);
  socket.binaryType = 'arraybuffer';
  state.socket = socket;

  socket.addEventListener('message', (event) => {
    if (typeof event.data === 'string') {
      setViewerStatus(event.data, true);
      return;
    }
    const blob = new Blob([event.data], { type: 'image/png' });
    // Release the previous object URL so a long-lived viewer session does not
    // accumulate detached blobs in memory.
    if (state.frameUrl) URL.revokeObjectURL(state.frameUrl);
    state.frameUrl = URL.createObjectURL(blob);
    elements.viewerImage.src = state.frameUrl;
    elements.viewerImage.classList.add('visible');
    elements.viewerEmpty.style.display = 'none';
  });

  socket.addEventListener('close', () => {
    setViewerStatus('Canal del visor cerrado.');
  });

  socket.addEventListener('error', () => {
    setViewerStatus('No se pudo abrir el canal del visor. Revisa el token.', true);
  });
}

elements.saveToken.addEventListener('click', async () => {
  state.token = elements.token.value.trim();
  sessionStorage.setItem('mbl-token', state.token);
  await refreshProfiles();
});

elements.createForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = elements.profileName.value.trim();
  const proxyHost = elements.proxyHost.value.trim();
  const proxyPort = elements.proxyPort.value.trim();
  const proxyType = elements.proxyType.value;

  const body = { name };
  if (proxyHost && proxyPort && proxyType) {
    body.proxy = { type: proxyType, host: proxyHost, port: Number(proxyPort) };
  }

  try {
    await api('/api/profiles', { method: 'POST', body: JSON.stringify(body) });
    elements.createForm.reset();
    setStatus(`Perfil "${name}" creado.`);
    await refreshProfiles();
  } catch (error) {
    setStatus(error.message, true);
  }
});

elements.viewerNavigate.addEventListener('click', async () => {
  const profileId = elements.viewerProfile.value;
  if (!profileId) return;
  try {
    await api(`/api/profiles/${profileId}/navigate`, {
      method: 'POST',
      body: JSON.stringify({ url: elements.viewerUrl.value.trim() }),
    });
    setViewerStatus('Navegación enviada.');
  } catch (error) {
    setViewerStatus(error.message, true);
  }
});

elements.viewerRefresh.addEventListener('click', () => {
  const profileId = elements.viewerProfile.value;
  if (!profileId) return;
  if (state.socket && state.socket.readyState === WebSocket.OPEN) {
    state.socket.send(JSON.stringify({ type: 'evaluate', expression: 'null' }));
  }
});

elements.viewerProfile.addEventListener('change', () => {
  selectViewerProfile(elements.viewerProfile.value);
});

elements.token.value = state.token;
refreshProfiles();
setInterval(refreshProfiles, 5000);
