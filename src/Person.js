export default function Person(props) {
  const { name, age, subject, address } = props;
  return (<div>
    <p>My name is {name} </p>
    <p>I'm {age} years old</p>
    <p>I learn {subject} now</p>
    { address && <p> I live in {address.city}, {address.street}</p>}
  </div>);
}