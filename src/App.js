import "./styles.css";
import Person from "./Person";
export default function App() {
  return (
    <div className="App">
      <h1>Hello CodeSandbox</h1>
      <h2>Start editing to see some magic happen!</h2>
      <Person
        name="Moshe"
        age={21}
        subject="React"
        address={{ city: "Bney Brak", street: "Rabi Akiva" }}
      />
    </div>
  );
}
