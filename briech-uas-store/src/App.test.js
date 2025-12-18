import { render, screen } from "@testing-library/react";
import App from "./App";

test("renders Briech UAS header", () => {
  render(<App />);
  const heading = screen.getByText(/Briech UAS Storage System/i);
  expect(heading).toBeInTheDocument();
});
