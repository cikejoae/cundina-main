import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";

/**
 * Ensures password-recovery links work even if they land on "/" (or any other route).
 * Moves recovery params (search/hash) to "/auth" where the reset UI lives.
 */
export function AuthLinkRouter() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (location.pathname === "/auth") return;

    const searchParams = new URLSearchParams(location.search);
    const hashParams = new URLSearchParams(
      location.hash.startsWith("#") ? location.hash.slice(1) : location.hash
    );

    const hasRecoveryQuery =
      searchParams.get("type") === "recovery" ||
      !!searchParams.get("error_code") ||
      !!searchParams.get("error") ||
      (!!searchParams.get("code") && searchParams.get("type") === "recovery");

    const hasRecoveryHash =
      hashParams.get("type") === "recovery" ||
      !!hashParams.get("access_token") ||
      !!hashParams.get("refresh_token") ||
      !!hashParams.get("error_code") ||
      !!hashParams.get("error") ||
      !!hashParams.get("error_description");

    if (!hasRecoveryQuery && !hasRecoveryHash) return;

    navigate(
      {
        pathname: "/auth",
        search: location.search,
        hash: location.hash,
      },
      { replace: true }
    );
  }, [location.pathname, location.search, location.hash, navigate]);

  return null;
}
