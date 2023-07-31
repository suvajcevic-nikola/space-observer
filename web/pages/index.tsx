import { useEffect } from "react";
import { useRouter } from "next/router";

const HomePage: React.FunctionComponent = () => {
  const router = useRouter();

  useEffect(() => {
    router.push("/earth");
  }, []);

  return null;
};

export default HomePage;
