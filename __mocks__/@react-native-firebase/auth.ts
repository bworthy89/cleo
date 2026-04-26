type MockUser = { uid: string } | null;

let currentUser: MockUser = { uid: 'test-uid' };

const authFn = jest.fn(() => ({
  get currentUser() { return currentUser; },
}));

export default authFn;

export function __setCurrentUser(user: MockUser) {
  currentUser = user;
}

export function __resetAuth() {
  currentUser = { uid: 'test-uid' };
}
