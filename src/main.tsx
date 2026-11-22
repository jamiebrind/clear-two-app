import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AudioLines, ChevronDown, Plus, Radar, RefreshCw, Speaker, Volume2, VolumeX } from 'lucide-react';
import { requestJson } from './client.ts';
import { ToneControls } from './ToneControls.tsx';
import { SpeakerSetup } from './SpeakerSetup.tsx';
import { GroupControls } from './GroupControls.tsx';
import type { RoomSummary } from './rooms.ts';
import type { LevelChange, SpeakerState } from './speaker.ts';
import './styles.css';

const roomsEndpoint = '/api/rooms';
const legacyRoomId = 'legacy';

interface RoomList {
  rooms: RoomSummary[];
  defaultId?: string;
  configuredId?: string;
}

function setUrlParameter(key: string, value: string | null) {
  const url = new URL(window.location.href);
  if (value === null) url.searchParams.delete(key);
  else url.searchParams.set(key, value);
  window.history.replaceState(null, '', url);
}

function App() {
  const [showSetup, setShowSetup] = useState(() => new URLSearchParams(window.location.search).has('setup'));
  const [selectedId, setSelectedId] = useState(() => new URLSearchParams(window.location.search).get('room'));
  const [roomList, setRoomList] = useState<RoomList>();
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [notice, setNotice] = useState('');
  const [roomsError, setRoomsError] = useState('');
  const reading = useRef(false);

  function select(id: string) {
    setSelectedId(id);
    setUrlParameter('room', id);
  }

  async function loadRooms(discover = false, newlyAddedId?: string) {
    if (reading.current) return;
    reading.current = true;
    if (discover) setScanning(true);
    else setLoading(true);
    setNotice('');
    setRoomsError('');
    try {
      const result = await requestJson<RoomList>(
        discover ? `${roomsEndpoint}/discover` : roomsEndpoint,
        discover ? {} : undefined,
        discover ? 10000 : undefined,
      );
      setRoomList(result);
      if (discover) {
        const available = result.rooms;
        setNotice(available.length
          ? `${available.length} ${available.length === 1 ? 'speaker' : 'speakers'} in your room list.`
          : 'No compatible speakers found. Check that the amps are on the same network as Clear Two.');
      }
    } catch (problem) {
      if (!discover && problem instanceof Error && problem.message === 'Unknown Clear Two endpoint.') {
        try {
          const speaker = await requestJson<SpeakerState>('/api/speaker');
          setRoomList({ rooms: [{ id: legacyRoomId, name: speaker.name }] });
          if (newlyAddedId) select(legacyRoomId);
        } catch (legacyProblem) {
          setRoomsError(legacyProblem instanceof Error ? legacyProblem.message : 'Could not load the speaker.');
        }
      } else setRoomsError(problem instanceof Error ? problem.message : 'Could not load speakers. Try again.');
    } finally {
      reading.current = false;
      setLoading(false);
      setScanning(false);
    }
  }

  useEffect(() => {
    if (!showSetup) void loadRooms();
  }, []);

  function openSetup() {
    setUrlParameter('setup', '');
    setShowSetup(true);
  }

  function closeSetup(roomId?: string) {
    setUrlParameter('setup', null);
    if (roomId && roomList?.rooms[0]?.id !== legacyRoomId) select(roomId);
    setShowSetup(false);
    void loadRooms(false, roomId);
  }

  const rooms = roomList?.rooms;
  const available = rooms ?? [];
  const explicitRoom = available.find(({ id }) => id === selectedId);
  const configuredId = roomList?.configuredId;
  const migratedRoom = selectedId === 'configured' && !explicitRoom ? available.find(({ id }) => id === configuredId) : undefined;
  const defaultRoom = available.find(({ id }) => id === roomList?.defaultId) ?? available[0];
  const selectedRoom = explicitRoom ?? migratedRoom ?? (selectedId === null ? defaultRoom : undefined);
  const unavailable = selectedId !== null && !selectedRoom && Boolean(available.length);
  const emptyHeading = roomsError ? 'Rooms unavailable' : loading || !rooms ? 'Loading rooms…'
    : unavailable ? 'Room unavailable' : 'Add your first speaker';

  useEffect(() => {
    if (selectedRoom && selectedRoom.id !== selectedId) select(selectedRoom.id);
  }, [selectedRoom, selectedId]);

  return (
    <main>
      <header className="masthead">
        <div className="brand"><span className="brand-mark"><AudioLines size={20} aria-hidden="true" /></span>Clear Two</div>
        {!showSetup && <button className="primary header-action" type="button" onClick={openSetup} disabled={scanning || loading}><Plus size={18} aria-hidden="true" />Add speaker</button>}
      </header>

      {showSetup ? <SpeakerSetup onClose={closeSetup} /> : <div className="workspace">
        <aside className="rooms-panel" aria-labelledby="rooms-heading">
          <div className="rooms-heading"><h2 id="rooms-heading">Rooms</h2>{rooms && <span className="room-count" aria-label={`${rooms.length} saved speakers`}>{rooms.length}</span>}</div>
          {available.length > 0 && <nav aria-label="Rooms">
            <ul className="room-list">
              {available.map(({ id, name }) => <li key={id}>
                <button type="button" className="room-choice" aria-current={selectedRoom?.id === id ? 'true' : undefined} onClick={() => select(id)}>
                  <span className="room-choice-icon"><Speaker size={19} aria-hidden="true" /></span><span>{name}</span>
                </button>
              </li>)}
            </ul>
          </nav>}
          {selectedRoom?.id !== legacyRoomId && <button type="button" className="mute scan-action" onClick={() => void loadRooms(true)} disabled={loading || scanning}>
            <Radar size={18} aria-hidden="true" />{scanning ? 'Searching…' : 'Scan network'}
          </button>}
          {notice && <p className="rooms-notice" role="status">{notice}</p>}
          {roomsError && <><p className="feedback" role="alert">{roomsError}</p><button type="button" className="text-action" onClick={() => void loadRooms()}>Reload rooms</button></>}
        </aside>

        {selectedRoom ? <Room key={selectedRoom.id} room={selectedRoom} rooms={available} /> : <section className="room room-empty" aria-labelledby="empty-heading">
          <div className="source-icon"><Speaker size={30} strokeWidth={1.65} aria-hidden="true" /></div>
          <h1 id="empty-heading">{emptyHeading}</h1>
          {rooms && !loading && <p>{unavailable ? 'Choose another speaker from the room list or scan the network.' : 'Scan for speakers that are already connected, or add a speaker to your Wi-Fi.'}</p>}
        </section>}
      </div>}
    </main>
  );
}

function Room({ room, rooms }: { room: RoomSummary; rooms: RoomSummary[] }) {
  const [speaker, setSpeaker] = useState<SpeakerState>();
  const [connection, setConnection] = useState<'connecting' | 'online' | 'offline'>('connecting');
  const [connectionError, setConnectionError] = useState('');
  const [controlError, setControlError] = useState('');
  const [draft, setDraft] = useState<number | null>(null);
  const [working, setWorking] = useState(false);
  const reading = useRef<Promise<SpeakerState> | null>(null);
  const changing = useRef(false);
  const legacy = room.id === legacyRoomId;
  const query = legacy ? '' : `?room=${encodeURIComponent(room.id)}`;

  const requestSpeaker = (level?: LevelChange) => requestJson<SpeakerState>(
    `${level ? '/api/speaker/level' : '/api/speaker'}${query}`, level,
  );

  async function refresh() {
    if (reading.current || changing.current) return;
    reading.current = requestSpeaker();
    try {
      setSpeaker(await reading.current);
      setConnection('online');
      setConnectionError('');
    } catch (error) {
      setConnection('offline');
      setConnectionError(error instanceof Error ? error.message : 'Could not reach the Clear Two bridge.');
    } finally {
      reading.current = null;
    }
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      if (!document.hidden) void refresh();
    }, 4000);
    return () => window.clearInterval(timer);
  }, []);

  async function applyLevel(level: LevelChange) {
    if (changing.current || connection !== 'online') return;
    changing.current = true;
    setWorking(true);
    setControlError('');
    let failed = false;
    try {
      await reading.current?.catch(() => {});
      setSpeaker(await requestSpeaker(level));
      setConnection('online');
      setConnectionError('');
    } catch (error) {
      failed = true;
      setControlError(error instanceof Error ? error.message : 'Could not confirm the new setting.');
    } finally {
      changing.current = false;
      setWorking(false);
      if ('volume' in level) setDraft(null);
      if (failed) void refresh();
    }
  }

  const volume = draft ?? speaker?.volume;
  const disabled = connection !== 'online' || working;
  const connectionLabel = { connecting: 'Connecting', online: 'Connected', offline: 'Offline' }[connection];

  return (
    <section className="room" aria-labelledby="selected-room">
        <div className="room-heading">
          <div><h1 id="selected-room">{speaker?.name ?? room.name}</h1>
            <div className={`connection ${connection}`} role="status"><span aria-hidden="true" />{connectionLabel}</div></div>
          <button type="button" className="icon-button" onClick={() => void refresh()} aria-label="Refresh speaker status" title="Refresh speaker status" disabled={working}><RefreshCw size={18} /></button>
        </div>
        {connectionError && <p className="feedback" role="status">{connectionError}</p>}

        {speaker && <><section className="playing" aria-labelledby="now-playing">
          <div className="source-icon"><AudioLines size={32} strokeWidth={1.6} aria-hidden="true" /></div>
          <div className="now-playing">
            <h2 id="now-playing">Now playing</h2>
            <p className="track">{speaker?.title ?? speaker?.source ?? 'Waiting for speaker'}</p>
            {speaker && <p className="source">{speaker.title ? [speaker.artist, speaker.source].filter(Boolean).join(' · ') : speaker.status}</p>}
          </div>
          {speaker?.title && <span className="playing-status">{speaker.status}</span>}
        </section>

        <section className="sound" aria-labelledby="sound">
          <div className="sound-heading"><h2 id="sound">Sound</h2><button className="mute" type="button" onClick={() => void applyLevel({ mute: !speaker?.muted })} disabled={disabled || speaker?.muted == null}>
            {speaker?.muted ? <VolumeX size={18} /> : <Volume2 size={18} />}{speaker?.muted ? 'Unmute' : 'Mute'}
          </button></div>
          <label htmlFor="volume">Volume<span>{volume == null ? 'Unavailable' : `${volume}%`}</span></label>
          <input id="volume" type="range" min="0" max="100" value={volume ?? 0} onChange={(event) => setDraft(Number(event.target.value))} disabled={disabled || speaker?.volume == null} />
          <div className="volume-actions"><button type="button" className="primary" disabled={disabled || draft === null || draft === speaker?.volume} onClick={() => { if (draft !== null) void applyLevel({ volume: draft }); }}>Set volume</button></div>
          {controlError && <p className="feedback" role="alert">{controlError}</p>}
        </section>

        {!legacy && <GroupControls room={room} rooms={rooms} online={connection === 'online'} onChange={() => void refresh()} />}
        <ToneControls roomId={legacy ? undefined : room.id} online={connection === 'online'} />
        <details className="device"><summary>Device information <ChevronDown size={18} aria-hidden="true" /></summary>
          <dl><div><dt>Board</dt><dd>{speaker.model ?? 'Unavailable'}</dd></div><div><dt>Network firmware</dt><dd>{speaker.firmware ?? 'Unavailable'}</dd></div></dl>
        </details></>}
    </section>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
