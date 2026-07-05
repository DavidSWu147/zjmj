const ID_KEY = 'zjmj-player-id';
const NAME_KEY = 'zjmj-player-name';

export function playerId(): string {
  let id = localStorage.getItem(ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(ID_KEY, id);
  }
  return id;
}

export function playerName(): string {
  let name = localStorage.getItem(NAME_KEY);
  if (!name) {
    name = `Guest-${Math.floor(1000 + Math.random() * 9000)}`;
    localStorage.setItem(NAME_KEY, name);
  }
  return name;
}

export function setPlayerName(name: string): void {
  localStorage.setItem(NAME_KEY, name.trim().slice(0, 24) || playerName());
}
