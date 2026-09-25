export default function Toolbar() {
  return (
    <nav className="toolbar" aria-label="Main navigation">
      <div className="toolbar-inner">
        <span className="toolbar-brand">Nozom Knowledge Bank</span>

        <div className="toolbar-links">
          <a href="#about">About</a>
          <a href="#feed">Knowledge Feed</a>
        </div>
      </div>
    </nav>
  );
}